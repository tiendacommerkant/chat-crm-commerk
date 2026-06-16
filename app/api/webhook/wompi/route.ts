import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { waitUntil } from '@vercel/functions';
import { supabaseAdmin, actualizarEstadoVenta } from '@/lib/supabase';
import { crearPedidoShopifyMultiItem, formatearPrecioCOP } from '@/lib/shopify';
import { enviarMensajeWhatsApp } from '@/lib/whatsapp';
import { enviarConfirmacionPago } from '@/lib/whatsapp-templates';
import { esRecogidaEnTienda, nombreSedeDesdeDireccion, buscarTelefonoSede } from '@/lib/sedes';
import type { WompiWebhookEvent } from '@/types';

const CONEXA_FORWARD_URL = 'https://wompi-event-shopify.conexa.ai/api/v1/shopify/webhooks/event';

// Procesamiento en background — no bloquea la respuesta al webhook
async function procesarTransaccionBot(payload: WompiWebhookEvent) {
  const transaction = payload.data?.transaction;
  if (!transaction) return;

  const reference = transaction.reference;

  // Traer TODAS las ventas de esta referencia (carrito puede tener varios productos)
  const { data: ventas } = await supabaseAdmin
    .from('ventas')
    .select('id, producto_shopify_id, producto_nombre, producto_precio, cantidad, total, direccion_envio, conversacion_id, cliente:clientes(id, nombre, telefono, email)')
    .eq('referencia_pago', reference);

  if (!ventas || ventas.length === 0) return;

  const cliente = ventas[0].cliente as any;
  const telefono: string = cliente?.telefono || '';
  const nombreCliente: string = cliente?.nombre || '';
  const conversacionId: string | null = ventas[0].conversacion_id || null;
  const direccionEnvio: string = (ventas[0] as any).direccion_envio || 'Sin especificar';
  const totalPedido = ventas.reduce((s, v) => s + Number(v.total), 0);

  // ¿El cliente eligió recoger en tienda?
  const recogida = esRecogidaEnTienda(direccionEnvio);
  const nombreSede = nombreSedeDesdeDireccion(direccionEnvio);

  if (transaction.status === 'APPROVED') {
    // 1. Marcar TODAS las ventas como pagadas (lo más crítico)
    await Promise.allSettled(
      ventas.map((v) =>
        actualizarEstadoVenta(v.id, 'pagado', { metodo_pago: transaction.payment_method_type })
      )
    );

    // 2. Crear UN solo pedido Shopify con todos los productos + notificar WhatsApp
    const resumenProductos = ventas.map((v) => `${v.producto_nombre} × ${v.cantidad}`).join(', ');
    const [shopifyResult] = await Promise.allSettled([
      crearPedidoShopifyMultiItem({
        items: ventas.map((v) => ({ productoShopifyId: v.producto_shopify_id, cantidad: v.cantidad })),
        clienteNombre: nombreCliente || null,
        clienteTelefono: telefono,
        clienteEmail: cliente?.email || null,
        direccionEnvio,
        referenciaPago: reference,
        metodoPago: transaction.payment_method_type,
      }),
      telefono ? enviarConfirmacionPago(telefono, nombreCliente, resumenProductos, formatearPrecioCOP(totalPedido)) : Promise.resolve(),
    ]);

    const orderNumber = shopifyResult.status === 'fulfilled' ? (shopifyResult.value as any)?.orderNumber : null;
    const shopifyOrderNum = orderNumber ? `#${orderNumber}` : '';

    // 3. Guardar mensaje de confirmación en conversación (no bloquea)
    if (telefono && conversacionId) {
      const lineasProductos = ventas
        .map((v) => `📦 *${v.producto_nombre}* × ${v.cantidad}`)
        .join('\n');
      const cierre = recogida
        ? `\n🏪 Tu pedido quedará *listo para recoger en ${nombreSede}*. Te avisamos apenas puedas pasar. ¡Gracias! 🎉`
        : `\n🚚 Te enviaremos tu pedido en las próximas 24-48 horas. ¡Gracias! 🎉`;
      const msgConfirmacion =
        `✅ *¡Pago confirmado!*\n\n` +
        `Hola ${nombreCliente.split(' ')[0] || 'amigo'}, recibimos tu pago correctamente.\n\n` +
        `${lineasProductos}\n` +
        `💵 Total pagado: *${formatearPrecioCOP(totalPedido)}*\n` +
        (shopifyOrderNum ? `🔢 Pedido Shopify: *${shopifyOrderNum}*\n` : '') +
        cierre;

      await Promise.allSettled([
        supabaseAdmin.from('mensajes').insert({
          conversacion_id: conversacionId,
          tipo: 'bot',
          contenido: msgConfirmacion,
          metadata: {
            tipo_wa: 'template',
            plantilla: 'confirmacion_pago',
            evento: 'pago_confirmado',
            referencia_pago: reference,
            shopify_order_number: orderNumber || null,
            awaiting: '',
          },
        }),
        supabaseAdmin
          .from('conversaciones')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', conversacionId),
        supabaseAdmin.from('notificaciones_wa').insert({
          telefono,
          tipo: 'pedido_confirmado',
          referencia_id: ventas[0].id,
          mensaje: `Pago confirmado. Pedido ${shopifyOrderNum}`,
          estado: 'enviado',
        }).then(),
      ]);
    }

    // 4. Si es recogida en tienda, avisar a la sede para que tengan el pedido listo
    if (recogida && nombreSede) {
      const telSede = buscarTelefonoSede(nombreSede);
      if (telSede) {
        const detalleSede = ventas
          .map((v) => `• ${v.producto_nombre} × ${v.cantidad}`)
          .join('\n');
        const msgSede =
          `🏪 *Nuevo pedido para RECOGER en ${nombreSede}*\n\n` +
          `👤 Cliente: ${nombreCliente || 'Sin nombre'}\n` +
          `📱 Tel: +${telefono}\n\n` +
          `${detalleSede}\n` +
          `💵 Total pagado: *${formatearPrecioCOP(totalPedido)}*\n` +
          (shopifyOrderNum ? `🔢 Pedido: *${shopifyOrderNum}*\n` : '') +
          `\n✅ *Pago confirmado por Wompi.* Por favor deja el pedido listo para entrega.`;
        await enviarMensajeWhatsApp(telSede, msgSede).catch((e) =>
          console.error('[Wompi] Error notificando a sede:', e?.message)
        );
      }
    }

  } else if (transaction.status === 'DECLINED' || transaction.status === 'VOIDED') {
    await Promise.allSettled(ventas.map((v) => actualizarEstadoVenta(v.id, 'cancelado')));

    if (telefono) {
      const msgDeclinado =
        `⚠️ *Pago no procesado*\n\n` +
        `Tu pago no fue aprobado.\n\n` +
        `Puedes intentarlo de nuevo o contactar a tu banco. 😊`;

      await Promise.allSettled([
        enviarMensajeWhatsApp(telefono, msgDeclinado),
        conversacionId
          ? supabaseAdmin.from('mensajes').insert({
              conversacion_id: conversacionId,
              tipo: 'bot',
              contenido: msgDeclinado,
              metadata: { tipo_wa: 'text', evento: 'pago_fallido', awaiting: '' },
            })
          : Promise.resolve(),
      ]);
    }
  }
}

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

  // Verificar firma de Wompi
  if (signature?.properties?.length) {
    let concatString = '';
    for (const prop of signature.properties) {
      const keys = prop.split('.');
      let value: any = payload;
      for (const key of keys) value = value?.[key];
      concatString += String(value ?? '');
    }
    concatString += payload.sent_at;
    concatString += secret;

    const expected = crypto.createHash('sha256').update(concatString).digest('hex');
    if (expected !== signature.checksum) {
      return NextResponse.json({ error: 'Invalid Signature' }, { status: 401 });
    }
  }

  // Solo procesar transacciones del bot (WA-)
  if (!transaction?.reference?.startsWith('WA-')) {
    return NextResponse.json({ success: true }, { status: 200 });
  }

  // Responde 200 de inmediato y procesa en background — Wompi no espera
  waitUntil(
    procesarTransaccionBot(payload).catch((err) =>
      console.error('[Wompi] Error en procesarTransaccionBot:', err?.message)
    )
  );

  return NextResponse.json({ success: true }, { status: 200 });
}
