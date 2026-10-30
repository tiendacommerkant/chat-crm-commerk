// ============================================
// SISTEMA DE NOTIFICACIONES WHATSAPP (pedidos de la tienda Shopify)
// ============================================
//
// WhatsApp solo entrega texto libre si el cliente escribió en las últimas
// 24 h. A un comprador de la tienda que nunca le escribió al bot, Meta acepta
// el texto y después lo descarta. Por eso: ventana abierta → texto completo;
// cerrada → plantilla de utilidad (pedido_tienda_recibido /
// pedido_tienda_despachado), con un texto que sirve para domicilio y recogida.

import { enviarMensajeWhatsApp, enviarPlantillaWhatsApp, formatearNumeroWhatsApp } from './whatsapp';
import { formatearPrecioCOP } from './shopify';
import { supabaseAdmin } from './supabase';
import { registrarEnvioPlantilla } from './costos';

const VENTANA_MS = 24 * 3_600_000;

type Resultado = { success: boolean; messageId?: string; error?: string };

async function logNotificacion(
  telefono: string,
  tipo: string,
  referenciaId: string,
  mensaje: string | null,
  resultado: Resultado,
  estado?: 'omitido'
) {
  await supabaseAdmin.from('notificaciones_wa').insert({
    telefono,
    tipo,
    referencia_id: referenciaId,
    mensaje,
    estado: estado || (resultado.success ? 'enviado' : 'fallido'),
    error: resultado.error || null,
    whatsapp_message_id: resultado.messageId || null,
  });
}

/** ¿El cliente le escribió al bot en las últimas 24 h? (solo entonces se puede enviar texto libre) */
export async function ventanaWhatsAppAbierta(telefono: string): Promise<boolean> {
  const { data: cliente } = await supabaseAdmin.from('clientes').select('id').eq('telefono', telefono).maybeSingle();
  if (!cliente) return false;
  const { data: convs } = await supabaseAdmin.from('conversaciones').select('id').eq('cliente_id', (cliente as any).id);
  const ids = ((convs as any[]) || []).map((c) => c.id);
  if (!ids.length) return false;
  const { data: ultimo } = await supabaseAdmin.from('mensajes').select('id')
    .in('conversacion_id', ids).eq('tipo', 'user')
    .gte('created_at', new Date(Date.now() - VENTANA_MS).toISOString())
    .limit(1).maybeSingle();
  return !!ultimo;
}

/** Texto libre si la ventana está abierta; si no, la plantilla aprobada. */
async function enviarTextoOPlantilla(
  telefono: string,
  texto: string,
  plantilla: { nombre: string; parametros: string[]; vista: string }
): Promise<{ resultado: Resultado; mensaje: string }> {
  if (await ventanaWhatsAppAbierta(telefono)) {
    return { resultado: await enviarMensajeWhatsApp(telefono, texto), mensaje: texto };
  }
  const resultado = await enviarPlantillaWhatsApp(telefono, plantilla.nombre, 'es', [{
    type: 'body',
    // Los parámetros de una plantilla no admiten saltos de línea
    parameters: plantilla.parametros.map((t) => ({ type: 'text', text: t.replace(/\s+/g, ' ').trim() || '-' })),
  }]);
  registrarEnvioPlantilla(plantilla.nombre, resultado.success).catch(() => {});
  return { resultado, mensaje: plantilla.vista };
}

function resumenItems(items: Array<{ title: string; quantity: number }>): string {
  const nombres = items.map((i) => (i.quantity > 1 ? `${i.title} x${i.quantity}` : i.title));
  if (nombres.length <= 1) return nombres[0] || 'tus productos';
  if (nombres.length === 2) return `${nombres[0]} y ${nombres[1]}`;
  return `${nombres[0]} y ${nombres.length - 1} productos más`;
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
  const total = formatearPrecioCOP(pedido.total);
  const itemsList = pedido.items
    .slice(0, 5)
    .map((i) => `   • ${i.title} x${i.quantity} — ${formatearPrecioCOP(Number(i.price) * i.quantity)}`)
    .join('\n');

  const texto =
    `🎉 *¡Pedido Confirmado!*\n\n` +
    `Hola ${nombre}, tu pedido *#${pedido.shopify_order_number}* está confirmado y en proceso. 🙌\n\n` +
    `📦 *Productos:*\n${itemsList}\n\n` +
    `💰 *Total: ${total}*\n\n` +
    `📍 Te avisaremos por aquí cuando tu pedido avance.\n\n` +
    `¡Gracias por comprar en *Tienda Commerk Antioquia*! 🍾`;
  const productos = resumenItems(pedido.items);

  const { resultado, mensaje } = await enviarTextoOPlantilla(telefono, texto, {
    nombre: 'pedido_tienda_recibido',
    parametros: [nombre, pedido.shopify_order_number, productos, total],
    vista: `✅ Hola ${nombre}, recibimos el pago de tu pedido #${pedido.shopify_order_number} en Tienda Commerk Antioquia.\n\n🛒 ${productos}\n💵 Total: ${total}\n\nTe avisaremos por este medio cuando tu pedido avance.`,
  });
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
// No hay plantilla de cancelación: solo se avisa si la ventana está abierta.

export async function notificarPedidoCancelado(pedido: {
  shopify_order_id: string;
  shopify_order_number: string;
  nombre_cliente: string;
  telefono: string;
  total: number;
}) {
  const telefono = formatearNumeroWhatsApp(pedido.telefono);
  if (!telefono) return { success: false, error: 'Número inválido' };

  if (!(await ventanaWhatsAppAbierta(telefono))) {
    const resultado = { success: false, error: 'Sin conversación en las últimas 24 h (no hay plantilla de cancelación)' };
    await logNotificacion(telefono, 'pedido_cancelado', pedido.shopify_order_id, null, resultado, 'omitido');
    return resultado;
  }

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
// Solo pedidos con envío: en uno para recoger en tienda, "fulfilled" significa
// que ya lo recogieron y un "va en camino" confundiría al cliente.

export async function notificarPedidoEnviado(pedido: {
  shopify_order_id: string;
  shopify_order_number: string;
  nombre_cliente: string;
  telefono: string;
  con_envio: boolean;
  tracking_number?: string;
  tracking_company?: string;
}) {
  const telefono = formatearNumeroWhatsApp(pedido.telefono);
  if (!telefono) return { success: false, error: 'Número inválido' };

  if (!pedido.con_envio) {
    const resultado = { success: false, error: 'Pedido sin envío (recogida en tienda o venta en punto)' };
    await logNotificacion(telefono, 'pedido_enviado', pedido.shopify_order_id, null, resultado, 'omitido');
    return resultado;
  }

  const nombre = pedido.nombre_cliente?.split(' ')[0] || 'amig@';
  const guia = pedido.tracking_number ? `Guía ${pedido.tracking_company || ''} ${pedido.tracking_number}`.replace(/\s+/g, ' ') : '';
  const texto =
    `🚚 *¡Tu pedido está en camino!*\n\n` +
    `Hola ${nombre}, tu pedido *#${pedido.shopify_order_number}* fue despachado.` +
    (guia ? `\n📮 *${guia}*` : '') +
    `\n\nSi tienes alguna pregunta sobre la entrega, escríbenos aquí 💬\n\n` +
    `_Tienda Commerk Antioquia_ 🍾`;
  const detalle = guia || 'Pronto lo recibirás en la dirección que registraste';

  const { resultado, mensaje } = await enviarTextoOPlantilla(telefono, texto, {
    nombre: 'pedido_tienda_despachado',
    parametros: [nombre, pedido.shopify_order_number, detalle],
    vista: `📦 Hola ${nombre}, tu pedido #${pedido.shopify_order_number} de Tienda Commerk Antioquia ya fue despachado.\n\n🚚 ${detalle}`,
  });
  await logNotificacion(telefono, 'pedido_enviado', pedido.shopify_order_id, mensaje, resultado);
  return resultado;
}
