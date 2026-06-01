import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { waitUntil } from '@vercel/functions';
import { supabaseAdmin, actualizarEstadoVenta } from '@/lib/supabase';
import { crearPedidoShopify, formatearPrecioCOP } from '@/lib/shopify';
import { enviarMensajeWhatsApp } from '@/lib/whatsapp';
import { enviarConfirmacionPago } from '@/lib/whatsapp-templates';
import type { WompiWebhookEvent } from '@/types';

const CONEXA_FORWARD_URL = 'https://wompi-event-shopify.conexa.ai/api/v1/shopify/webhooks/event';

// Procesamiento en background — no bloquea la respuesta al webhook
async function procesarTransaccionBot(payload: WompiWebhookEvent) {
  const transaction = payload.data?.transaction;
  if (!transaction) return;

  const reference = transaction.reference;

  const { data: venta } = await supabaseAdmin
    .from('ventas')
    .select('id, producto_shopify_id, producto_nombre, producto_precio, cantidad, total, direccion_envio, conversacion_id, cliente:clientes(id, nombre, telefono, email)')
    .eq('referencia_pago', reference)
    .maybeSingle();

  if (transaction.status === 'APPROVED' && venta) {
    const cliente = venta.cliente as any;
    const telefono: string = cliente?.telefono || '';
    const nombreCliente: string = cliente?.nombre || '';

    // 1. Marcar venta como pagada (primero, lo más crítico)
    await actualizarEstadoVenta(venta.id, 'pagado', {
      metodo_pago: transaction.payment_method_type,
    });

    // 2. Crear pedido Shopify + notificar WhatsApp en paralelo
    const [shopifyResult] = await Promise.allSettled([
      crearPedidoShopify({
        productoShopifyId: venta.producto_shopify_id,
        cantidad: venta.cantidad,
        clienteNombre: nombreCliente || null,
        clienteTelefono: telefono,
        clienteEmail: cliente?.email || null,
        direccionEnvio: (venta as any).direccion_envio || 'Sin especificar',
        referenciaPago: reference,
        metodoPago: transaction.payment_method_type,
      }),
      telefono ? enviarConfirmacionPago(telefono, nombreCliente, venta.producto_nombre, formatearPrecioCOP(Number(venta.total))) : Promise.resolve(),
    ]);

    const orderNumber = shopifyResult.status === 'fulfilled' ? (shopifyResult.value as any)?.orderNumber : null;
    const shopifyOrderNum = orderNumber ? `#${orderNumber}` : '';

    // 3. Guardar mensaje de confirmación en conversación (no bloquea)
    if (telefono && venta.conversacion_id) {
      const totalFormateado = formatearPrecioCOP(Number(venta.total));
      const msgConfirmacion =
        `✅ *¡Pago confirmado!*\n\n` +
        `Hola ${nombreCliente.split(' ')[0] || 'amigo'}, recibimos tu pago correctamente.\n\n` +
        `📦 *${venta.producto_nombre}* × ${venta.cantidad}\n` +
        `💵 Total pagado: *${totalFormateado}*\n` +
        (shopifyOrderNum ? `🔢 Pedido Shopify: *${shopifyOrderNum}*\n` : '') +
        `\n🚚 Te enviaremos tu pedido en las próximas 24-48 horas. ¡Gracias! 🎉`;

      await Promise.allSettled([
        supabaseAdmin.from('mensajes').insert({
          conversacion_id: venta.conversacion_id,
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
          .eq('id', venta.conversacion_id),
        supabaseAdmin.from('notificaciones_wa').insert({
          telefono,
          tipo: 'pedido_confirmado',
          referencia_id: venta.id,
          mensaje: `Pago confirmado. Pedido ${shopifyOrderNum}`,
          estado: 'enviado',
        }).then(),
      ]);
    }

  } else if ((transaction.status === 'DECLINED' || transaction.status === 'VOIDED') && venta) {
    const cliente = venta.cliente as any;
    const telefono: string = cliente?.telefono || '';

    await actualizarEstadoVenta(venta.id, 'cancelado');

    if (telefono) {
      const msgDeclinado =
        `⚠️ *Pago no procesado*\n\n` +
        `Tu pago para *${venta.producto_nombre}* no fue aprobado.\n\n` +
        `Puedes intentarlo de nuevo o contactar a tu banco. 😊`;

      await Promise.allSettled([
        enviarMensajeWhatsApp(telefono, msgDeclinado),
        venta.conversacion_id
          ? supabaseAdmin.from('mensajes').insert({
              conversacion_id: venta.conversacion_id,
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
