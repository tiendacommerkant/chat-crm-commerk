// ============================================
// SISTEMA DE NOTIFICACIONES WHATSAPP
// ============================================

import { enviarMensajeWhatsApp, formatearNumeroWhatsApp } from './whatsapp';
import { formatearPrecioCOP } from './shopify';
import { supabaseAdmin } from './supabase';

async function logNotificacion(
  telefono: string,
  tipo: string,
  referenciaId: string,
  mensaje: string,
  resultado: { success: boolean; messageId?: string; error?: string }
) {
  await supabaseAdmin.from('notificaciones_wa').insert({
    telefono,
    tipo,
    referencia_id: referenciaId,
    mensaje,
    estado: resultado.success ? 'enviado' : 'fallido',
    error: resultado.error || null,
    whatsapp_message_id: resultado.messageId || null,
  });
}

// ─── PEDIDO CONFIRMADO (orders/paid) ─────────────────────────────────────────

export async function notificarPedidoConfirmado(pedido: {
  shopify_order_id: string;
  shopify_order_number: string;
  nombre_cliente: string;
  telefono: string;
  total: number;
  items: Array<{ title: string; quantity: number; price: string | number }>;
}) {
  const telefono = formatearNumeroWhatsApp(pedido.telefono);
  if (!telefono) return { success: false, error: 'Número inválido' };

  const nombre = pedido.nombre_cliente?.split(' ')[0] || 'amig@';
  const itemsList = pedido.items
    .slice(0, 5)
    .map((i) => `   • ${i.title} x${i.quantity} — ${formatearPrecioCOP(Number(i.price) * i.quantity)}`)
    .join('\n');

  const mensaje =
    `🎉 *¡Pedido Confirmado!*\n\n` +
    `Hola ${nombre}, tu pedido *#${pedido.shopify_order_number}* está confirmado y en proceso. 🙌\n\n` +
    `📦 *Productos:*\n${itemsList}\n\n` +
    `💰 *Total: ${formatearPrecioCOP(pedido.total)}*\n\n` +
    `⏰ Entrega estimada: 24-48 horas hábiles\n` +
    `📍 Te avisaremos cuando esté listo para despacho.\n\n` +
    `¡Gracias por comprar en *Tienda Commerk Antioquia*! 🍾`;

  const resultado = await enviarMensajeWhatsApp(telefono, mensaje);
  await logNotificacion(telefono, 'pedido_confirmado', pedido.shopify_order_id, mensaje, resultado);

  if (resultado.success) {
    await supabaseAdmin
      .from('pedidos_shopify')
      .update({ notificado_whatsapp: true })
      .eq('shopify_order_id', parseInt(pedido.shopify_order_id));
  }

  return resultado;
}

// ─── PEDIDO CANCELADO (orders/cancelled) ─────────────────────────────────────

export async function notificarPedidoCancelado(pedido: {
  shopify_order_id: string;
  shopify_order_number: string;
  nombre_cliente: string;
  telefono: string;
  total: number;
}) {
  const telefono = formatearNumeroWhatsApp(pedido.telefono);
  if (!telefono) return { success: false, error: 'Número inválido' };

  const nombre = pedido.nombre_cliente?.split(' ')[0] || 'amig@';

  const mensaje =
    `😔 *Pedido Cancelado*\n\n` +
    `Hola ${nombre}, tu pedido *#${pedido.shopify_order_number}* (${formatearPrecioCOP(pedido.total)}) ha sido cancelado.\n\n` +
    `Si fue un error o tienes preguntas, escríbenos aquí mismo y te ayudamos de inmediato 💬\n\n` +
    `_Tienda Commerk Antioquia_`;

  const resultado = await enviarMensajeWhatsApp(telefono, mensaje);
  await logNotificacion(telefono, 'pedido_cancelado', pedido.shopify_order_id, mensaje, resultado);
  return resultado;
}

// ─── PEDIDO ENVIADO (orders/fulfilled) ───────────────────────────────────────

export async function notificarPedidoEnviado(pedido: {
  shopify_order_id: string;
  shopify_order_number: string;
  nombre_cliente: string;
  telefono: string;
  tracking_number?: string;
  tracking_company?: string;
}) {
  const telefono = formatearNumeroWhatsApp(pedido.telefono);
  if (!telefono) return { success: false, error: 'Número inválido' };

  const nombre = pedido.nombre_cliente?.split(' ')[0] || 'amig@';
  const trackingInfo = pedido.tracking_number
    ? `\n📮 *Guía:* ${pedido.tracking_company || ''} ${pedido.tracking_number}`
    : '';

  const mensaje =
    `🚚 *¡Tu pedido está en camino!*\n\n` +
    `Hola ${nombre}, tu pedido *#${pedido.shopify_order_number}* fue despachado.` +
    `${trackingInfo}\n\n` +
    `⏰ Llegará en las próximas horas. Mantente pendiente.\n\n` +
    `_Tienda Commerk Antioquia_ 🍾`;

  const resultado = await enviarMensajeWhatsApp(telefono, mensaje);
  await logNotificacion(telefono, 'pedido_enviado', pedido.shopify_order_id, mensaje, resultado);
  return resultado;
}

// ─── CARRITO ABANDONADO ───────────────────────────────────────────────────────

export async function notificarCarritoAbandonado(carrito: {
  id: string;
  shopify_checkout_id: string;
  nombre?: string | null;
  telefono: string;
  total: number;
  url_checkout?: string | null;
  items: Array<{ title: string; quantity: number }>;
}) {
  const telefono = formatearNumeroWhatsApp(carrito.telefono);
  if (!telefono) return { success: false, error: 'Número inválido' };

  const nombre = carrito.nombre?.split(' ')[0] || 'amig@';
  const itemsList = carrito.items
    .slice(0, 3)
    .map((i) => `   • ${i.title} x${i.quantity}`)
    .join('\n');
  const linkRecuperacion = carrito.url_checkout
    ? `\n\n🔗 Retoma tu compra aquí:\n${carrito.url_checkout}`
    : '';

  const mensaje =
    `🛒 *¡Olvidaste algo!*\n\n` +
    `Hola ${nombre}, dejaste estos productos en tu carrito:\n\n` +
    `${itemsList}\n\n` +
    `💰 *Total: ${formatearPrecioCOP(carrito.total)}*` +
    `${linkRecuperacion}\n\n` +
    `¿Te ayudamos a completar el pedido? Escríbenos aquí 💬\n\n` +
    `_Tienda Commerk Antioquia_ 🍾`;

  const resultado = await enviarMensajeWhatsApp(telefono, mensaje);
  await logNotificacion(telefono, 'carrito_abandonado', carrito.shopify_checkout_id, mensaje, resultado);

  if (resultado.success) {
    await supabaseAdmin
      .from('carritos_abandonados')
      .update({ notificado_whatsapp: true, estado: 'notificado', updated_at: new Date().toISOString() })
      .eq('id', carrito.id);
  }

  return resultado;
}
