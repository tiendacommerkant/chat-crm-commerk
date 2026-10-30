// ============================================
// RECORDATORIOS AUTOMÁTICOS DE CARRITO (links de pago del bot sin pagar)
// ============================================
//
// Antes se enviaba una plantilla por cada producto: el 29 de octubre una
// clienta empresarial recibió 5 mensajes seguidos a las 5:39 a. m. por un
// solo pedido. Ahora va un mensaje por cliente, con el resumen del pedido, y
// no se le escribe a quien ya atiende una persona del equipo.

import { supabaseAdmin } from './supabase';
import { enviarCarritoAbandonado } from './whatsapp-templates';
import { formatearPrecioCOP } from './shopify';
import { registrarEvento } from './eventos';

// Etiquetas que gestiona el equipo de ventas: no reciben mensajes automáticos
const ETIQUETAS_EQUIPO = ['empresarial', 'mayorista'];

function resumenProductos(items: any[]): string {
  const nombres = Array.from(new Set(items.map((v) => v.producto_nombre).filter(Boolean)));
  if (nombres.length <= 1) return nombres[0] || 'tu pedido';
  if (nombres.length === 2) return `${nombres[0]} y ${nombres[1]}`;
  return `${nombres[0]} y ${nombres.length - 1} productos más`;
}

export async function recordarCarritosAbandonados(): Promise<{ clientes: number; enviados: number; resultados: { cliente: string; ok: boolean; motivo?: string }[] }> {
  const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  // Un pedido de hace más de una semana ya no se recuerda: el mensaje llegaría fuera de lugar
  const hace7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: ventas, error } = await supabaseAdmin
    .from('ventas')
    .select('*, clientes(*), conversacion:conversaciones(id, estado_atencion, etiqueta)')
    .eq('estado', 'pendiente')
    .lt('created_at', hace24h)
    .gt('created_at', hace7d)
    .eq('carrito_recordatorio_enviado', false)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    await registrarEvento('error', 'recordatorios', `Carrito abandonado: no se pudieron leer las ventas (${error.message})`);
    throw error;
  }

  // Un mensaje por cliente
  const porCliente = new Map<string, any[]>();
  for (const v of ventas || []) {
    const clave = v.cliente_id || v.id;
    if (!porCliente.has(clave)) porCliente.set(clave, []);
    porCliente.get(clave)!.push(v);
  }

  const resultados: { cliente: string; ok: boolean; motivo?: string }[] = [];

  for (const [clienteId, items] of Array.from(porCliente.entries())) {
    const reciente = items[0];
    const cliente = reciente.clientes as any;
    const conv = reciente.conversacion as any;
    // El pedido más reciente del cliente (todas sus líneas comparten referencia)
    const pedido = items.filter((v) => (v.referencia_pago || v.id) === (reciente.referencia_pago || reciente.id));

    let motivo: string | undefined;
    if (!cliente?.telefono) motivo = 'sin teléfono';
    else if (conv && ['pendiente', 'en_atencion'].includes(conv.estado_atencion)) motivo = 'lo atiende un asesor';
    else if (conv && ETIQUETAS_EQUIPO.includes(conv.etiqueta)) motivo = `etiqueta ${conv.etiqueta}`;
    else {
      const { count } = await supabaseAdmin.from('ventas').select('id', { count: 'exact', head: true })
        .eq('cliente_id', clienteId).eq('estado', 'pagado').gt('created_at', reciente.created_at);
      if (count) motivo = 'ya compró después';
    }

    let ok = false;
    const total = formatearPrecioCOP(pedido.reduce((s, v) => s + Number(v.total || 0), 0));
    const productos = resumenProductos(pedido);
    if (!motivo) {
      ok = await enviarCarritoAbandonado(cliente.telefono, cliente.nombre || 'Cliente', productos, total);
      if (!ok) motivo = 'WhatsApp no aceptó la plantilla';
    }

    // Todas sus ventas pendientes quedan marcadas: nunca se le repite
    await supabaseAdmin.from('ventas').update({ carrito_recordatorio_enviado: true }).in('id', items.map((v) => v.id));

    if (ok && reciente.conversacion_id) {
      await supabaseAdmin.from('mensajes').insert({
        conversacion_id: reciente.conversacion_id,
        tipo: 'bot',
        contenido:
          `🛒 *Recordatorio de carrito enviado automáticamente*\n\n` +
          `Hola ${(cliente.nombre || 'Cliente').split(' ')[0]}, notamos que dejaste *${productos}* (${total}) en tu carrito.\n\n` +
          `¿Quieres completar tu compra?`,
        metadata: { tipo_wa: 'template', plantilla: 'carrito_abandonado', evento: 'carrito_automatico', awaiting: '' },
      });
      await supabaseAdmin.from('conversaciones').update({ updated_at: new Date().toISOString() }).eq('id', reciente.conversacion_id);
    }

    resultados.push({ cliente: clienteId, ok, motivo });
  }

  const enviados = resultados.filter((r) => r.ok).length;
  if (resultados.length) {
    await registrarEvento('info', 'recordatorios', `Carrito abandonado: ${enviados} enviado(s), ${resultados.length - enviados} omitido(s)`);
  }
  return { clientes: resultados.length, enviados, resultados };
}
