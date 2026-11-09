// ============================================
// PAGOS DEL BOT — qué pasa cuando Wompi aprueba (o rechaza) un pago
// ============================================
// Marca las ventas, crea el pedido en Shopify, confirma al cliente por
// WhatsApp y avisa a la sede si es recogida. Lo llama el webhook de Wompi y
// también el bot cuando el cliente dice "ya pagué" y el pago aparece aprobado
// al consultar Wompi (red de seguridad si el webhook falló).

import { supabaseAdmin, actualizarEstadoVenta } from './supabase';
import { crearPedidoShopifyMultiItem, formatearPrecioCOP } from './shopify';
import { enviarMensajeWhatsApp } from './whatsapp';
import { esIdUsuarioWhatsApp } from './whatsapp-id';
import { enviarConfirmacionPago, enviarPedidoRecogerSede } from './whatsapp-templates';
import { esRecogidaEnTienda, nombreSedeDesdeDireccion, buscarTelefonoSede } from './sedes';
import { registrarEvento } from './eventos';
import type { WompiWebhookEvent } from '@/types';

export type TransaccionWompi = WompiWebhookEvent['data']['transaction'];

// Mismas constantes/regla de envío que en bot-logic.ts y ai-sofi.ts — necesarias
// aquí para recalcular el total real cobrado (ver comentario más abajo).
const COSTO_ENVIO        = parseInt(process.env.SHIPPING_COST || '8000');
const ENVIO_GRATIS_DESDE = parseInt(process.env.FREE_SHIPPING_THRESHOLD || '149000');

const CAMPOS_VENTA = 'id, estado, referencia_pago, producto_shopify_id, producto_nombre, producto_precio, cantidad, total, direccion_envio, conversacion_id, cliente:clientes(id, nombre, telefono, email)';

/**
 * Ventas del bot que paga esta transacción (un carrito tiene una fila por producto).
 * Los links de pago del bot no llevan la referencia WA-: Wompi les pone la suya
 * ("<link>_<hora>_<azar>") y manda el id del link en payment_link_id. Antes solo
 * se buscaba por WA- y ningún pago hecho con el link se reconocía.
 */
async function ventasDeTransaccion(transaction: TransaccionWompi) {
  if (transaction.reference?.startsWith('WA-')) {
    const { data } = await supabaseAdmin.from('ventas').select(CAMPOS_VENTA).eq('referencia_pago', transaction.reference);
    if (data?.length) return data;
  }
  if (!transaction.payment_link_id) return [];
  const { data } = await supabaseAdmin.from('ventas').select(CAMPOS_VENTA)
    .like('link_pago', `%/l/${transaction.payment_link_id}`);
  return data || [];
}

// Procesamiento en background — no bloquea la respuesta al webhook
export async function procesarTransaccionBot(transaction: TransaccionWompi) {

  const ventas = await ventasDeTransaccion(transaction);
  if (!ventas.length) return;
  // Referencia del bot (WA-…): es la que conocen el CRM, el pedido de Shopify y los mensajes
  const reference: string = (ventas[0] as any).referencia_pago || transaction.reference;

  // Idempotencia: Wompi puede reintentar la entrega del mismo evento (timeout,
  // respuesta lenta, etc.). Sin esto, cada reintento de "APPROVED" creaba OTRO
  // pedido en Shopify y reenviaba los mensajes de confirmación al cliente y a
  // la sede. Si ya se procesó, no repetir nada. Un intento rechazado deja la
  // venta "cancelada", pero el cliente puede volver a intentar con el mismo
  // link: un pago aprobado posterior sí se procesa.
  const yaProcesado = transaction.status === 'APPROVED'
    ? ventas.every((v) => v.estado === 'pagado')
    : ventas.every((v) => v.estado !== 'pendiente');
  if (yaProcesado) {
    console.log(`[Wompi] Referencia ${reference} ya procesada (estado actual: ${ventas[0].estado}) — evento repetido, se ignora.`);
    return;
  }

  const cliente = ventas[0].cliente as any;
  const telefono: string = cliente?.telefono || '';
  const nombreCliente: string = cliente?.nombre || '';
  const conversacionId: string | null = ventas[0].conversacion_id || null;
  const direccionEnvio: string = (ventas[0] as any).direccion_envio || 'Sin especificar';

  // ¿El cliente eligió recoger en tienda?
  const recogida = esRecogidaEnTienda(direccionEnvio);
  const nombreSede = nombreSedeDesdeDireccion(direccionEnvio);

  // El total real cobrado incluye el envío (si aplica), pero cada fila de
  // "ventas" guarda solo el subtotal de SU ítem (sin envío). Sumarlas da el
  // subtotal del carrito; hay que sumar el envío con la MISMA regla usada al
  // generar el link de pago para que el mensaje de confirmación no le diga al
  // cliente un total menor al que realmente se le cobró.
  const subtotalPedido = ventas.reduce((s, v) => s + Number(v.total), 0);
  const envioAplicado = recogida ? 0 : (subtotalPedido >= ENVIO_GRATIS_DESDE ? 0 : COSTO_ENVIO);
  // El monto que Wompi realmente cobró es la verdad: si la regla de envío
  // cambió entre que se generó el link y se pagó, recalcular daría otro total.
  const montoCobrado = Number((transaction as any).amount_in_cents) / 100;
  const totalPedido = montoCobrado > 0 ? Math.round(montoCobrado) : subtotalPedido + envioAplicado;

  if (transaction.status === 'APPROVED') {
    // 1. Marcar TODAS las ventas como pagadas (lo más crítico). Solo el primer
    // aviso que las encuentre pendientes sigue: Wompi puede repetir el evento y
    // dos avisos casi simultáneos creaban dos pedidos.
    // (ventas no tiene columna de método de pago: va en la nota del pedido de Shopify)
    const { data: reclamadas, error: errReclamo } = await supabaseAdmin
      .from('ventas')
      .update({ estado: 'pagado', updated_at: new Date().toISOString() })
      .in('id', ventas.map((v) => v.id))
      .in('estado', ['pendiente', 'cancelado'])
      .select('id');
    if (errReclamo) {
      await registrarEvento('error', 'wompi', `Pago aprobado de ${reference} pero no se pudo marcar la venta: ${errReclamo.message}`);
      return;
    }
    if (!reclamadas?.length) return;
    await registrarEvento('info', 'wompi', `Pago del bot aprobado: ${reference} (${formatearPrecioCOP(totalPedido)})`);

    // 2. Crear UN solo pedido Shopify con todos los productos + notificar WhatsApp
    const resumenProductos = ventas.map((v) => `${v.producto_nombre} × ${v.cantidad}`).join(', ');
    const [shopifyResult] = await Promise.allSettled([
      crearPedidoShopifyMultiItem({
        items: ventas.map((v) => ({
          productoShopifyId: v.producto_shopify_id, cantidad: v.cantidad, productoNombre: v.producto_nombre,
          precioUnitario: Number(v.producto_precio) || (v.cantidad ? Number(v.total) / v.cantidad : null),
        })),
        clienteNombre: nombreCliente || null,
        // Un cliente con nombre de usuario no tiene número: Shopify rechaza
        // un "teléfono" con formato de ID de usuario y el pedido no se crearía.
        clienteTelefono: esIdUsuarioWhatsApp(telefono) ? '' : telefono,
        clienteEmail: cliente?.email || null,
        direccionEnvio,
        referenciaPago: reference,
        metodoPago: transaction.payment_method_type,
      }),
      telefono ? enviarConfirmacionPago(telefono, nombreCliente, resumenProductos, formatearPrecioCOP(totalPedido)) : Promise.resolve(),
    ]);

    const orderNumber = shopifyResult.status === 'fulfilled' ? (shopifyResult.value as any)?.orderNumber : null;
    const shopifyOrderNum = orderNumber ? `#${orderNumber}` : '';
    if (!orderNumber) {
      const motivo = shopifyResult.status === 'fulfilled' ? (shopifyResult.value as any)?.error : (shopifyResult as any).reason?.message;
      await registrarEvento('error', 'wompi', `Pago confirmado de ${reference} pero NO se creó el pedido en Shopify: ${motivo || 'sin detalle'}`);
    }

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
        const detalleProductos = ventas
          .map((v) => `${v.producto_nombre} × ${v.cantidad}`)
          .join(', ');
        const totalFmt = formatearPrecioCOP(totalPedido);
        const pedidoRef = shopifyOrderNum || reference;

        // Plantilla (llega siempre, incluso fuera de la ventana de 24h)
        const okPlantilla = await enviarPedidoRecogerSede(
          telSede,
          nombreSede,
          nombreCliente || 'Cliente',
          `+${telefono}`,
          detalleProductos,
          totalFmt,
          pedidoRef
        ).catch(() => false);

        // Fallback a texto libre si la plantilla aún no está aprobada/disponible
        if (!okPlantilla) {
          const msgSede =
            `🏪 *Nuevo pedido para RECOGER en ${nombreSede}*\n\n` +
            `👤 Cliente: ${nombreCliente || 'Sin nombre'}\n` +
            `📱 Tel: +${telefono}\n\n` +
            `${ventas.map((v) => `• ${v.producto_nombre} × ${v.cantidad}`).join('\n')}\n` +
            `💵 Total pagado: *${totalFmt}*\n` +
            (shopifyOrderNum ? `🔢 Pedido: *${shopifyOrderNum}*\n` : '') +
            `\n✅ *Pago confirmado por Wompi.* Por favor deja el pedido listo para entrega.`;
          await enviarMensajeWhatsApp(telSede, msgSede).catch((e) =>
            console.error('[Wompi] Error notificando a sede:', e?.message)
          );
        }
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
