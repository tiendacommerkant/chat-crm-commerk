import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { firmaWompiValida } from '@/lib/firma-wompi';
import { registrarEvento } from '@/lib/eventos';
import { procesarTransaccionBot } from '@/lib/pagos-bot';
import { reenviarAConexa } from '@/lib/conexa';
import { esPagoDeLaTienda } from '@/lib/vigilancia-tienda';
import { formatearPrecioCOP } from '@/lib/shopify';
import type { WompiWebhookEvent } from '@/types';

// Crea el pedido en Shopify y notifica por WhatsApp en background (waitUntil):
// sin margen de tiempo, Vercel corta el proceso y el pago queda sin confirmar.
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let rawBody = '';
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }

  // Reenviar a Conexa (app de Wompi en Shopify) SIEMPRE y ESPERAR la respuesta:
  // con este evento Shopify crea los pedidos de la tienda web. Antes salía sin
  // esperar y Vercel podía cortarlo al responder (ver lib/conexa.ts).
  const conexa = await reenviarAConexa(rawBody);

  let payload: WompiWebhookEvent;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ success: true }, { status: 200 });
  }

  const secret = process.env.WOMPI_EVENT_SECRET || '';
  const { signature, data } = payload;
  const transaction = data?.transaction;
  const timestamp = (payload as any).timestamp;

  // Verificar firma de Wompi — OBLIGATORIA. Antes, si el payload llegaba sin
  // "signature.properties" la verificación se SALTABA por completo y el evento
  // se procesaba igual: cualquiera podía forjar un POST con status "APPROVED"
  // (sin firma) y el bot creaba el pedido en Shopify y confirmaba el pago sin
  // que Wompi hubiera cobrado nada. Ahora se exige secreto configurado y firma
  // válida siempre; si falta cualquiera de los dos, se rechaza.
  if (!secret) {
    console.error('[Wompi] WOMPI_EVENT_SECRET no configurado — rechazando webhook por seguridad');
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }
  if (!signature?.properties?.length || !signature?.checksum) {
    console.error('[Wompi] Webhook sin firma — rechazado');
    return NextResponse.json({ error: 'Missing signature' }, { status: 401 });
  }
  if (!firmaWompiValida({ data, signature, timestamp }, secret)) {
    console.error('[Wompi] Firma inválida — posible intento de forjar el webhook');
    await registrarEvento('aviso', 'wompi', `Evento de Wompi rechazado (firma inválida): ${transaction?.reference || 'sin referencia'}`);
    return NextResponse.json({ error: 'Invalid Signature' }, { status: 401 });
  }

  // Pago de la tienda web: sin el evento en Conexa, Shopify no crea el pedido.
  // Si no lo recibió, queda en "Estado del sistema" (con el evento original
  // para reenviarlo). Si fue una falla pasajera (sin respuesta, 5xx) se
  // responde 502 para que Wompi lo reintente; un rechazo (4xx) no se arregla
  // reenviando lo mismo.
  const deLaTienda = !!transaction?.reference && esPagoDeLaTienda(transaction as any);
  let reintentarWompi = false;
  if (deLaTienda) {
    const aprobado = transaction!.status === 'APPROVED';
    const resumen = `${transaction!.reference} (${transaction!.status}, ${formatearPrecioCOP((transaction!.amount_in_cents || 0) / 100)})`;
    if (conexa.ok) {
      if (aprobado) {
        await registrarEvento('info', 'wompi', `Pago de la tienda web aprobado y entregado a la app de Wompi en Shopify: ${resumen}`, { referencia: transaction!.reference });
      }
    } else {
      const pasajera = conexa.status === null || conexa.status >= 500 || conexa.status === 408 || conexa.status === 429;
      reintentarWompi = pasajera;
      await registrarEvento(aprobado ? 'error' : 'aviso', 'wompi',
        `La app de Wompi en Shopify no recibió el pago ${resumen}: ${conexa.error}.` +
        (pasajera ? ' Wompi lo volverá a enviar;' : '') + ' Si el pedido no aparece en Shopify, créalo a mano.',
        { referencia: transaction!.reference, conexa: conexa.error, intentos: conexa.intentos, evento: rawBody.slice(0, 20_000) });
    }
  }
  const respuesta = () => reintentarWompi
    ? NextResponse.json({ error: 'Conexa no recibió el evento' }, { status: 502 })
    : NextResponse.json({ success: true }, { status: 200 });

  // Solo transacciones que pueden ser del bot: referencia WA- o pago hecho con un
  // link (procesarTransaccionBot busca la venta y no hace nada si no es del bot)
  if (!transaction || (!transaction.reference?.startsWith('WA-') && !transaction.payment_link_id)) {
    return respuesta();
  }

  // Responde de inmediato y procesa en background — Wompi no espera
  waitUntil(
    procesarTransaccionBot(transaction).catch((err) =>
      console.error('[Wompi] Error en procesarTransaccionBot:', err?.message)
    )
  );

  return respuesta();
}
