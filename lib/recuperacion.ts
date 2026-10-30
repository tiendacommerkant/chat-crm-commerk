// ============================================
// RECUPERACIÓN DE CARRITOS DE SHOPIFY POR WHATSAPP
// ============================================
//
// Desde mayo el recordatorio se enviaba como texto libre. WhatsApp solo
// entrega texto libre si el cliente escribió en las últimas 24 h: a un
// comprador de la tienda que nunca le ha escrito al bot, Meta acepta el envío
// y después lo descarta (error 131047). Los ~400 recordatorios quedaron como
// "enviado" sin saberse si llegaron. Ahora:
//   · ventana abierta → texto con el link del carrito;
//   · ventana cerrada → plantilla aprobada carrito_abandonado;
//   · nunca de noche, ni a quien pidió no recibir publicidad, ni a quien ya
//     atiende un asesor, ni a quien ya compró, ni dos veces en la misma semana;
//   · el recordatorio queda en el chat del CRM con su estado de entrega real,
//     y si el cliente responde, el bot le manda el link (lib/bot/carrito-tienda.ts).

import { supabaseAdmin, buscarOCrearCliente, obtenerConversacionActiva } from './supabase';
import { enviarMensajeWhatsApp, enviarPlantillaWhatsApp } from './whatsapp';
import { registrarEnvioPlantilla } from './costos';
import { formatearPrecioCOP } from './shopify';
import { ABANDONO_MINUTOS, celularColombiano, sincronizarCarritosShopify } from './carritos';
import { registrarEvento } from './eventos';

// Colombia no cambia de horario en el año: siempre UTC-5
const OFFSET_COLOMBIA_MS = 5 * 3_600_000;
export const HORARIO_ENVIO = { desde: 8, hasta: 20 };
const VENTANA_MS = 24 * 3_600_000;
const DIAS_ENTRE_RECORDATORIOS = 7;
// Un carrito de más de un día ya no se recuerda: el mensaje llegaría fuera de lugar
const VIGENCIA_MS = 24 * 3_600_000;

export interface CarritoFila {
  id: string;
  shopify_checkout_id: string;
  nombre?: string | null;
  telefono?: string | null;
  email?: string | null;
  total?: number | string | null;
  url_checkout?: string | null;
  items?: Array<{ title: string; quantity: number }> | null;
  shopify_created_at?: string | null;
}

export interface ResultadoRecuperacion {
  enviado: boolean;
  via?: 'texto' | 'plantilla';
  motivo?: string;
}

/** Solo se escribe de 8 a. m. a 8 p. m. (hora de Colombia). */
export function horaDeEnviar(fecha = new Date()): boolean {
  const hora = new Date(fecha.getTime() - OFFSET_COLOMBIA_MS).getUTCHours();
  return hora >= HORARIO_ENVIO.desde && hora < HORARIO_ENVIO.hasta;
}

/** "Ron Viejo de Caldas x2 y 1 producto más" — una línea, apta para plantilla. */
export function resumenCarrito(items: Array<{ title: string; quantity: number }> | null | undefined): string {
  const nombres = (items || [])
    .filter((i) => i?.title)
    .map((i) => (i.quantity > 1 ? `${i.title} x${i.quantity}` : i.title).replace(/\s+/g, ' ').trim());
  if (!nombres.length) return 'tus productos';
  if (nombres.length === 1) return nombres[0];
  if (nombres.length === 2) return `${nombres[0]} y ${nombres[1]}`;
  const resto = nombres.length - 1;
  return `${nombres[0]} y ${resto} producto${resto === 1 ? '' : 's'} más`;
}

function textoConLink(nombre: string, items: CarritoFila['items'], total: string, url: string | null | undefined): string {
  const lista = (items || []).slice(0, 3).map((i) => `   • ${i.title} x${i.quantity}`).join('\n');
  return (
    `🛒 *¡Olvidaste algo!*\n\n` +
    `Hola ${nombre || 'amig@'}, dejaste estos productos en tu carrito:\n\n` +
    `${lista}\n\n` +
    `💰 *Total: ${total}*` +
    (url ? `\n\n🔗 Retoma tu compra aquí:\n${url}` : '') +
    `\n\n¿Te ayudamos a completar el pedido? Escríbenos aquí 💬\n\n` +
    `_Tienda Commerk Antioquia_ 🍾`
  );
}

// Lo que ve el cliente con la plantilla aprobada (para mostrarlo igual en el CRM)
function textoPlantilla(nombre: string, productos: string, total: string): string {
  return (
    `👋 Hola ${nombre || 'Cliente'}, ¿olvidaste algo?\n\n` +
    `Dejaste esto en tu carrito:\n🛒 ${productos}\n💵 ${total}\n\n` +
    `Todavía lo tenemos disponible. Escríbenos y lo dejamos listo para ti.`
  );
}

/** Carrito que no se recuerda: queda marcado para no volver a intentarlo y con el motivo en el registro. */
async function omitir(carrito: CarritoFila, telefono: string, motivo: string, estado?: 'convertido'): Promise<ResultadoRecuperacion> {
  await supabaseAdmin.from('carritos_abandonados')
    .update({ notificado_whatsapp: true, ...(estado && { estado }), updated_at: new Date().toISOString() })
    .eq('id', carrito.id);
  await supabaseAdmin.from('notificaciones_wa').insert({
    telefono, tipo: 'carrito_abandonado', referencia_id: carrito.shopify_checkout_id, estado: 'omitido', error: motivo,
  });
  return { enviado: false, motivo };
}

/** ¿Compró en la tienda (mismo correo o celular) después de dejar el carrito? */
async function comproDespues(carrito: CarritoFila, telefono: string): Promise<boolean> {
  const desde = carrito.shopify_created_at || new Date(Date.now() - VIGENCIA_MS).toISOString();
  const base = () => supabaseAdmin.from('pedidos_shopify').select('id', { count: 'exact', head: true })
    .gt('shopify_created_at', desde).in('estado_financiero', ['paid', 'pending', 'authorized']);
  const consultas = [base().ilike('telefono', `%${telefono.slice(-10)}`)];
  if (carrito.email) consultas.push(base().eq('email', carrito.email));
  const resultados = await Promise.all(consultas);
  return resultados.some((r) => (r.count || 0) > 0);
}

export async function recuperarCarrito(carrito: CarritoFila, { manual = false } = {}): Promise<ResultadoRecuperacion> {
  const telefono = celularColombiano(carrito.telefono || null);
  if (!telefono) return { enviado: false, motivo: 'El carrito no tiene un celular colombiano válido' };
  if (!manual && !horaDeEnviar()) return { enviado: false, motivo: 'fuera del horario de envío' };

  // Reclamar el carrito: la tarea programada y cada pestaña abierta del CRM
  // corren esto a la vez; solo quien logra marcarlo envía el mensaje.
  if (!manual) {
    const { data: reclamado } = await supabaseAdmin.from('carritos_abandonados')
      .update({ notificado_whatsapp: true }).eq('id', carrito.id).eq('notificado_whatsapp', false).select('id');
    if (!reclamado?.length) return { enviado: false, motivo: 'Otro proceso ya lo está enviando' };
  }

  const { data: cliente } = await supabaseAdmin
    .from('clientes').select('id, nombre, no_publicidad').eq('telefono', telefono).maybeSingle();
  if ((cliente as any)?.no_publicidad) return omitir(carrito, telefono, 'El cliente pidió no recibir publicidad');

  if (await comproDespues(carrito, telefono)) return omitir(carrito, telefono, 'Ya compró después de dejar el carrito', 'convertido');

  const { data: conv } = cliente
    ? await supabaseAdmin.from('conversaciones').select('id, estado_atencion')
      .eq('cliente_id', (cliente as any).id).eq('estado', 'activa')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    : { data: null };

  if (!manual) {
    if (conv && ['pendiente', 'en_atencion'].includes((conv as any).estado_atencion)) {
      return omitir(carrito, telefono, 'Lo está atendiendo un asesor');
    }
    const desde = new Date(Date.now() - DIAS_ENTRE_RECORDATORIOS * 86_400_000).toISOString();
    const { count } = await supabaseAdmin.from('notificaciones_wa').select('id', { count: 'exact', head: true })
      .eq('telefono', telefono).eq('tipo', 'carrito_abandonado').in('estado', ['enviado', 'entregado', 'leido'])
      .gte('created_at', desde);
    if (count) return omitir(carrito, telefono, 'Ya recibió un recordatorio esta semana');
  }

  // Ventana de 24 h: ¿el cliente nos escribió hace poco?
  let ventanaAbierta = false;
  if (conv) {
    const { data: ultimo } = await supabaseAdmin.from('mensajes').select('created_at')
      .eq('conversacion_id', (conv as any).id).eq('tipo', 'user')
      .gte('created_at', new Date(Date.now() - VENTANA_MS).toISOString())
      .limit(1).maybeSingle();
    ventanaAbierta = !!ultimo;
  }

  const nombre = (carrito.nombre || (cliente as any)?.nombre || '').split(' ')[0];
  const productos = resumenCarrito(carrito.items);
  const total = formatearPrecioCOP(Number(carrito.total || 0));

  let texto: string;
  let envio: { success: boolean; messageId?: string; error?: string };
  if (ventanaAbierta) {
    texto = textoConLink(nombre, carrito.items, total, carrito.url_checkout);
    envio = await enviarMensajeWhatsApp(telefono, texto);
  } else {
    texto = textoPlantilla(nombre, productos, total);
    envio = await enviarPlantillaWhatsApp(telefono, 'carrito_abandonado', 'es', [{
      type: 'body',
      parameters: [nombre || 'Cliente', productos, total].map((t) => ({ type: 'text', text: t })),
    }]);
    registrarEnvioPlantilla('carrito_abandonado', envio.success).catch(() => {});
  }

  await supabaseAdmin.from('notificaciones_wa').insert({
    telefono,
    tipo: 'carrito_abandonado',
    referencia_id: carrito.shopify_checkout_id,
    mensaje: texto,
    estado: envio.success ? 'enviado' : 'fallido',
    error: envio.error || null,
    whatsapp_message_id: envio.messageId || null,
  });

  // Enviado o no, no se reintenta solo: un error repetido cada 10 minutos
  // no ayuda. El equipo puede reenviarlo desde Carritos.
  await supabaseAdmin.from('carritos_abandonados').update({
    notificado_whatsapp: true,
    ...(envio.success && { estado: 'notificado' }),
    updated_at: new Date().toISOString(),
  }).eq('id', carrito.id);

  if (!envio.success) {
    await registrarEvento('error', 'carritos', `No se pudo enviar el recordatorio de carrito: ${envio.error || 'sin respuesta de WhatsApp'}`);
    return { enviado: false, motivo: envio.error || 'WhatsApp no aceptó el mensaje' };
  }

  // En el chat del CRM: el equipo ve el recordatorio y su estado de entrega,
  // y el bot reconoce la respuesta del cliente.
  try {
    const conversacionId = (conv as any)?.id
      || (await obtenerConversacionActiva((cliente as any)?.id || (await buscarOCrearCliente(telefono, carrito.nombre || undefined)).id)).id;
    await supabaseAdmin.from('mensajes').insert({
      conversacion_id: conversacionId,
      tipo: 'bot',
      contenido: texto,
      metadata: {
        tipo_wa: ventanaAbierta ? 'text' : 'template',
        ...(!ventanaAbierta && { plantilla: 'carrito_abandonado' }),
        evento: 'carrito_recuperacion',
        whatsapp_message_id: envio.messageId || null,
        carrito_url: carrito.url_checkout || null,
        carrito_productos: productos,
        carrito_total: total,
      },
    });
    await supabaseAdmin.from('conversaciones').update({ updated_at: new Date().toISOString() }).eq('id', conversacionId);
  } catch (e: any) {
    await registrarEvento('aviso', 'carritos', `Recordatorio enviado, pero no quedó en el chat del CRM: ${e?.message || e}`);
  }

  return { enviado: true, via: ventanaAbierta ? 'texto' : 'plantilla' };
}

// ─── Campaña única: recordar carritos de varios días atrás ──────────────────
// Se programa en configuracion.campana_carritos. La corre la primera revisión
// que llegue después de la hora fijada (tarea de 10 min, tarea diaria o CRM
// abierto) y, si se le acaba el tiempo, sigue en la siguiente. Un mensaje por
// persona (su carrito más reciente) y las mismas reglas del envío automático.

export const CLAVE_CAMPANA = 'campana_carritos';

export interface CampanaCarritos {
  carritos_desde: string; // carritos actualizados desde esta fecha
  inicia: string; // no se envía nada antes de esta hora
  estado: 'pendiente' | 'en_curso' | 'terminada' | 'cancelada';
  enviados?: number;
  omitidos?: number;
  terminada?: string;
}

export async function leerCampanaCarritos(): Promise<CampanaCarritos | null> {
  const { data } = await supabaseAdmin.from('configuracion').select('valor').eq('clave', CLAVE_CAMPANA).maybeSingle();
  return ((data as any)?.valor as CampanaCarritos) || null;
}

async function guardarCampana(campana: CampanaCarritos) {
  await supabaseAdmin.from('configuracion').upsert({
    clave: CLAVE_CAMPANA, valor: campana, actualizado_por: 'sistema', updated_at: new Date().toISOString(),
  }, { onConflict: 'clave' });
}

export async function avanzarCampanaCarritos(hasta: number): Promise<{ enviados: number; omitidos: number; terminada: boolean } | null> {
  const campana = await leerCampanaCarritos();
  if (!campana || !['pendiente', 'en_curso'].includes(campana.estado)) return null;
  if (Date.now() < new Date(campana.inicia).getTime() || !horaDeEnviar()) return null;

  const { data: carritos, error } = await supabaseAdmin
    .from('carritos_abandonados')
    .select('*')
    .eq('estado', 'abandonado')
    .eq('notificado_whatsapp', false)
    .not('telefono', 'is', null)
    .gte('shopify_updated_at', campana.carritos_desde)
    .lt('shopify_updated_at', new Date(Date.now() - ABANDONO_MINUTOS * 60_000).toISOString())
    .order('shopify_updated_at', { ascending: false })
    .limit(500);
  if (error) throw error;

  let enviados = 0;
  let omitidos = 0;
  let pendientes = 0;
  const vistos = new Set<string>();
  for (const carrito of (carritos || []) as CarritoFila[]) {
    const telefono = celularColombiano(carrito.telefono || null) || carrito.telefono || carrito.id;
    if (vistos.has(telefono)) {
      // Carrito más viejo de alguien que ya recibe el del más reciente
      await supabaseAdmin.from('carritos_abandonados').update({ notificado_whatsapp: true }).eq('id', carrito.id);
      continue;
    }
    if (Date.now() > hasta) { pendientes++; continue; }
    vistos.add(telefono);
    try {
      const r = await recuperarCarrito(carrito);
      if (r.enviado) enviados++;
      else omitidos++;
    } catch (e: any) {
      omitidos++;
      await registrarEvento('error', 'carritos', `Campaña de carritos ${carrito.shopify_checkout_id}: ${e?.message || e}`);
    }
  }

  const terminada = pendientes === 0;
  const total = { enviados: (campana.enviados || 0) + enviados, omitidos: (campana.omitidos || 0) + omitidos };
  await guardarCampana({
    ...campana,
    ...total,
    estado: terminada ? 'terminada' : 'en_curso',
    ...(terminada && { terminada: new Date().toISOString() }),
  });
  if (terminada) {
    await registrarEvento('info', 'carritos', `Campaña de carritos terminada: ${total.enviados} recordatorio(s) enviado(s), ${total.omitidos} omitido(s)`);
  }
  return { enviados, omitidos, terminada };
}

/**
 * Trae los carritos nuevos de Shopify y recuerda los abandonados del último
 * día (y avanza la campaña programada, si hay). La llaman la tarea programada
 * (cada 10 min), la tarea diaria y el CRM abierto. `hasta`: límite de tiempo
 * para no pasarse de los 60 s de la función.
 */
export async function procesarCarritosPendientes(hasta = Date.now() + 45_000): Promise<{
  sincronizacion: { revisados: number; guardados: number };
  enviados: number;
  omitidos: number;
  campana?: { enviados: number; omitidos: number; terminada: boolean } | null;
  motivo?: string;
}> {
  const sincronizacion = await sincronizarCarritosShopify(24);
  const ahora = Date.now();
  const corteAbandono = new Date(ahora - ABANDONO_MINUTOS * 60_000).toISOString();

  await supabaseAdmin.from('carritos_abandonados')
    .update({ estado: 'abandonado', updated_at: new Date(ahora).toISOString() })
    .eq('estado', 'en_progreso')
    .lt('shopify_updated_at', corteAbandono);

  if (!horaDeEnviar(new Date(ahora))) {
    return { sincronizacion, enviados: 0, omitidos: 0, motivo: 'fuera del horario de envío' };
  }

  const { data: carritos, error } = await supabaseAdmin
    .from('carritos_abandonados')
    .select('*')
    .eq('estado', 'abandonado')
    .eq('notificado_whatsapp', false)
    .not('telefono', 'is', null)
    .lt('shopify_updated_at', corteAbandono)
    .gt('shopify_updated_at', new Date(ahora - VIGENCIA_MS).toISOString())
    .order('shopify_updated_at', { ascending: true })
    .limit(20);
  if (error) throw error;

  let enviados = 0;
  let omitidos = 0;
  for (const carrito of (carritos || []) as CarritoFila[]) {
    try {
      const r = await recuperarCarrito(carrito);
      if (r.enviado) enviados++;
      else omitidos++;
    } catch (e: any) {
      omitidos++;
      await registrarEvento('error', 'carritos', `Recordatorio de carrito ${carrito.shopify_checkout_id}: ${e?.message || e}`);
    }
  }
  if (enviados || omitidos) {
    await registrarEvento('info', 'carritos', `Carritos de la tienda: ${enviados} recordatorio(s) enviado(s), ${omitidos} omitido(s)`);
  }
  const campana = await avanzarCampanaCarritos(hasta);
  return { sincronizacion, enviados, omitidos, campana };
}
