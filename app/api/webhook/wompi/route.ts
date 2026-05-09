import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin, actualizarEstadoVenta } from '@/lib/supabase';
import { crearPedidoShopify, formatearPrecioCOP } from '@/lib/shopify';
import { enviarMensajeWhatsApp } from '@/lib/whatsapp';
import type { WompiWebhookEvent } from '@/types';

const CONEXA_FORWARD_URL = 'https://wompi-event-shopify.conexa.ai/api/v1/shopify/webhooks/event';

export async function POST(req: Request) {
  let rawBody = '';
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }

  // Reenviar a Conexa (Shopify sigue recibiendo eventos del sitio web)
  // Se hace antes del procesamiento para que siempre llegue aunque falle nuestro código
  fetch(CONEXA_FORWARD_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: rawBody,
  }).catch((err) => console.error('Error reenviando a Conexa:', err));

  try {
    const payload: WompiWebhookEvent = JSON.parse(rawBody);
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

    if (!transaction) {
      return NextResponse.json({ success: true }, { status: 200 });
    }

    const reference = transaction.reference;

    // Buscar la venta por referencia — solo las ventas del bot (referencia WA-)
    // Las ventas del sitio web las maneja Conexa directamente
    if (!reference?.startsWith('WA-')) {
      return NextResponse.json({ success: true }, { status: 200 });
    }

    const { data: venta } = await supabaseAdmin
      .from('ventas')
      .select('id, producto_shopify_id, producto_nombre, producto_precio, cantidad, total, direccion_envio, conversacion_id, cliente:clientes(id, nombre, telefono, email)')
      .eq('referencia_pago', reference)
      .maybeSingle();

    if (transaction.status === 'APPROVED' && venta) {
      const cliente = venta.cliente as any;
      const telefono: string = cliente?.telefono || '';
      const nombreCliente: string = cliente?.nombre || '';

      // 1. Marcar venta como pagada
      await actualizarEstadoVenta(venta.id, 'pagado', {
        metodo_pago: transaction.payment_method_type,
      });

      // 2. Crear pedido en Shopify
      const shopifyResult = await crearPedidoShopify({
        productoShopifyId: venta.producto_shopify_id,
        cantidad: venta.cantidad,
        clienteNombre: nombreCliente || null,
        clienteTelefono: telefono,
        clienteEmail: cliente?.email || null,
        direccionEnvio: (venta as any).direccion_envio || 'Sin especificar',
        referenciaPago: reference,
        metodoPago: transaction.payment_method_type,
      });

      const shopifyOrderNum = shopifyResult.orderNumber ? `#${shopifyResult.orderNumber}` : '';

      // 3. Notificar al cliente por WhatsApp
      if (telefono) {
        const msgConfirmacion =
          `✅ *¡Pago confirmado!*\n\n` +
          `Hola ${nombreCliente.split(' ')[0] || 'amigo'}, recibimos tu pago correctamente.\n\n` +
          `📦 *${venta.producto_nombre}* × ${venta.cantidad}\n` +
          `💵 Total pagado: *${formatearPrecioCOP(Number(venta.total))}*\n` +
          (shopifyOrderNum ? `🔢 Pedido Shopify: *${shopifyOrderNum}*\n` : '') +
          `\n🚚 Procesaremos y enviaremos tu pedido en las próximas 24-48 horas.\n\n` +
          `¡Gracias por comprar en *Tienda Commerk*! 🎉`;

        await enviarMensajeWhatsApp(telefono, msgConfirmacion);

        // 4. Guardar en conversación si existe
        if (venta.conversacion_id) {
          await supabaseAdmin.from('mensajes').insert({
            conversacion_id: venta.conversacion_id,
            tipo: 'bot',
            contenido: msgConfirmacion,
            metadata: {
              tipo_wa: 'text',
              evento: 'pago_confirmado',
              referencia_pago: reference,
              shopify_order_number: shopifyResult.orderNumber || null,
              awaiting: '',
            },
          });
          await supabaseAdmin
            .from('conversaciones')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', venta.conversacion_id);
        }
      }

      // 5. Registrar notificación
      try {
        await supabaseAdmin.from('notificaciones_wa').insert({
          telefono: telefono || '',
          tipo: 'pedido_confirmado',
          referencia_id: venta.id,
          mensaje: `Pago confirmado. Pedido ${shopifyOrderNum}`,
          estado: telefono ? 'enviado' : 'fallido',
        });
      } catch { /* tabla opcional */ }

    } else if ((transaction.status === 'DECLINED' || transaction.status === 'VOIDED') && venta) {
      await actualizarEstadoVenta(venta.id, 'cancelado');

      const cliente = venta.cliente as any;
      const telefono: string = cliente?.telefono || '';

      if (telefono) {
        const msgDeclinado =
          `⚠️ *Pago no procesado*\n\n` +
          `Tu pago para *${venta.producto_nombre}* no fue aprobado.\n\n` +
          `Puedes intentarlo de nuevo escribiendo el nombre del producto o contactar a tu banco. 😊`;

        await enviarMensajeWhatsApp(telefono, msgDeclinado);

        if (venta.conversacion_id) {
          await supabaseAdmin.from('mensajes').insert({
            conversacion_id: venta.conversacion_id,
            tipo: 'bot',
            contenido: msgDeclinado,
            metadata: { tipo_wa: 'text', evento: 'pago_fallido', awaiting: '' },
          });
        }
      }
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Wompi webhook error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
