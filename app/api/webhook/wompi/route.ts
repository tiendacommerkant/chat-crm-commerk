import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { firmaWompiValida } from '@/lib/firma-wompi';
import { registrarEvento } from '@/lib/eventos';
import { procesarTransaccionBot } from '@/lib/pagos-bot';
import type { WompiWebhookEvent } from '@/types';

// Crea el pedido en Shopify y notifica por WhatsApp en background (waitUntil):
// sin margen de tiempo, Vercel corta el proceso y el pago queda sin confirmar.
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const CONEXA_FORWARD_URL = 'https://wompi-event-shopify.conexa.ai/api/v1/shopify/webhooks/event';

export async function POST(req: Request) {
  let rawBody = '';
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }

  // Reenviar a Conexa siempre (pedidos del sitio web)
  fetch(CONEXA_FORWARD_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: rawBody,
  }).catch((err) => console.error('Error reenviando a Conexa:', err));

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

  // Solo transacciones que pueden ser del bot: referencia WA- o pago hecho con un
  // link (procesarTransaccionBot busca la venta y no hace nada si no es del bot)
  if (!transaction || (!transaction.reference?.startsWith('WA-') && !transaction.payment_link_id)) {
    return NextResponse.json({ success: true }, { status: 200 });
  }

  // Responde 200 de inmediato y procesa en background — Wompi no espera
  waitUntil(
    procesarTransaccionBot(transaction).catch((err) =>
      console.error('[Wompi] Error en procesarTransaccionBot:', err?.message)
    )
  );

  return NextResponse.json({ success: true }, { status: 200 });
}
