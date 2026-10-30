// ============================================
// DIFUSIONES — mensajes masivos con plantilla aprobada a un grupo de clientes
// ============================================
//
// Solo a clientes que aceptaron la política de privacidad, con un celular
// válido y que no pidieron la baja ("no quiero recibir más mensajes").

import { supabaseAdmin, obtenerConversacionActiva } from './supabase';
import { enviarPlantillaWhatsApp, esIdUsuarioWhatsApp } from './whatsapp';
import { celularColombiano } from './carritos';
import { registrarEnvioPlantilla, TARIFA_WA_MARKETING, TARIFA_WA_UTILITY, USD_A_COP } from './costos';

export interface Segmento {
  compro?: 'si' | 'no' | '';   // compró alguna vez (tienda o bot)
  sede?: string;                // sede preferida
  etiqueta?: string;            // etiqueta de su conversación
  activos_dias?: number;        // escribió en los últimos N días
}

export interface Destinatario { cliente_id: string; telefono: string; nombre: string | null }

/** Reemplaza {nombre} por el primer nombre del cliente. */
export function prepararParametros(parametros: string[], nombre: string | null): string[] {
  const primero = (nombre || '').trim().split(/\s+/)[0] || 'cliente';
  return parametros.map((p) => p.replace(/\{nombre\}/gi, primero));
}

/** Costo aproximado en pesos según la categoría de la plantilla. */
export function costoEstimado(cantidad: number, categoria: string | null | undefined): number {
  const usd = (String(categoria).toUpperCase() === 'MARKETING' ? TARIFA_WA_MARKETING : TARIFA_WA_UTILITY) * cantidad;
  return Math.round(usd * USD_A_COP);
}

/** El cliente pide no recibir más publicidad. */
export function esPedidoDeBaja(t: string): boolean {
  return /(no (quiero|deseo) (recibir|que me (env[ií]en|manden|escriban))( m[aá]s)?( mensajes| publicidad| promociones| ofertas)?|no me (env[ií]en|manden|escriban) m[aá]s|dejen de (enviarme|escribirme|mandarme)|darme de baja|dar(me)? de baja|^baja$|desuscrib|no m[aá]s (mensajes|publicidad|promociones))/i.test(t.trim());
}

async function idsDeConversaciones(filtro: (q: any) => any): Promise<Set<string>> {
  const { data } = await filtro(supabaseAdmin.from('conversaciones').select('cliente_id')).limit(10000);
  return new Set(((data as any[]) || []).map((c) => c.cliente_id).filter(Boolean));
}

/** Clientes que cumplen el segmento (sin repetir teléfonos). */
export async function obtenerAudiencia(seg: Segmento): Promise<Destinatario[]> {
  const base = () => {
    let q = supabaseAdmin.from('clientes').select('id, telefono, nombre').eq('politicas_aceptadas', true).not('telefono', 'is', null).limit(10000);
    if (seg.sede) q = q.eq('sede_preferida', seg.sede);
    return q;
  };
  let { data: clientes, error } = await base().eq('no_publicidad', false);
  if (error && /no_publicidad/.test(error.message)) ({ data: clientes, error } = await base()); // migración pendiente
  if (error) throw error;

  let lista = (clientes as any[]) || [];

  if (seg.compro === 'si' || seg.compro === 'no') {
    const [{ data: pedidos }, { data: ventas }] = await Promise.all([
      supabaseAdmin.from('pedidos_shopify').select('cliente_id, telefono').in('estado_financiero', ['paid', 'partially_refunded']).limit(20000),
      supabaseAdmin.from('ventas').select('cliente_id').eq('estado', 'pagado').limit(20000),
    ]);
    const ids = new Set([...(pedidos || []), ...(ventas || [])].map((p: any) => p.cliente_id).filter(Boolean));
    const tels = new Set((pedidos || []).map((p: any) => celularColombiano(p.telefono)).filter(Boolean));
    const compro = (c: any) => ids.has(c.id) || tels.has(celularColombiano(c.telefono));
    lista = lista.filter((c) => (seg.compro === 'si' ? compro(c) : !compro(c)));
  }
  if (seg.etiqueta) {
    const ids = await idsDeConversaciones((q) => q.eq('etiqueta', seg.etiqueta));
    lista = lista.filter((c) => ids.has(c.id));
  }
  if (seg.activos_dias && seg.activos_dias > 0) {
    const desde = new Date(Date.now() - seg.activos_dias * 86_400_000).toISOString();
    const ids = await idsDeConversaciones((q) => q.gte('updated_at', desde));
    lista = lista.filter((c) => ids.has(c.id));
  }

  const vistos = new Set<string>();
  const salida: Destinatario[] = [];
  for (const c of lista) {
    const tel = esIdUsuarioWhatsApp(c.telefono) ? c.telefono : celularColombiano(c.telefono);
    if (!tel || vistos.has(tel)) continue;
    vistos.add(tel);
    salida.push({ cliente_id: c.id, telefono: tel, nombre: c.nombre || null });
  }
  return salida;
}

/**
 * Envía el siguiente lote de una difusión. El CRM lo llama en bucle mientras
 * muestra el avance; si se cierra la página, se retoma donde quedó.
 */
export async function enviarLote(difusionId: string, tamano = 20) {
  const { data: dif, error } = await supabaseAdmin.from('difusiones').select('*').eq('id', difusionId).single();
  if (error || !dif) throw new Error('Difusión no encontrada');
  if (dif.estado === 'cancelada' || dif.estado === 'completada') return { estado: dif.estado, enviados: dif.enviados, fallidos: dif.fallidos, total: dif.total, pendientes: 0 };

  const { data: lote } = await supabaseAdmin.from('difusion_envios').select('*')
    .eq('difusion_id', difusionId).eq('estado', 'pendiente').limit(tamano);

  const params = dif.parametros || {};
  let enviados = 0;
  let fallidos = 0;
  for (const e of (lote as any[]) || []) {
    const cuerpo = prepararParametros(params.cuerpo || [], e.nombre);
    const components: any[] = [];
    if (cuerpo.length) components.push({ type: 'body', parameters: cuerpo.map((t) => ({ type: 'text', text: t })) });
    if (params.boton) components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: String(params.boton) }] });

    const r = await enviarPlantillaWhatsApp(e.telefono, dif.plantilla, dif.idioma || 'es', components);
    registrarEnvioPlantilla(dif.plantilla, r.success).catch(() => {});
    await supabaseAdmin.from('difusion_envios').update({
      estado: r.success ? 'enviado' : 'fallido',
      error: r.success ? null : (r.error || 'Error').slice(0, 300),
      whatsapp_message_id: r.messageId || null,
      enviado_en: new Date().toISOString(),
    }).eq('id', e.id);

    if (r.success) {
      enviados++;
      // Queda en la conversación del cliente para que el equipo lo vea en el chat
      if (e.cliente_id) {
        try {
          const conv = await obtenerConversacionActiva(e.cliente_id);
          const texto = (params.texto || `Difusión: ${dif.nombre}`).replace(/\{nombre\}/gi, (e.nombre || '').split(' ')[0] || 'cliente');
          await supabaseAdmin.from('mensajes').insert({
            conversacion_id: conv.id, tipo: 'bot', contenido: texto,
            metadata: { tipo_wa: 'template', plantilla: dif.plantilla, difusion_id: dif.id, whatsapp_message_id: r.messageId || null },
          });
        } catch { /* el envío ya salió; el registro en el chat es secundario */ }
      }
    } else {
      fallidos++;
    }
  }

  const { count: pendientes } = await supabaseAdmin.from('difusion_envios').select('id', { count: 'exact', head: true })
    .eq('difusion_id', difusionId).eq('estado', 'pendiente');
  const totales = { enviados: (dif.enviados || 0) + enviados, fallidos: (dif.fallidos || 0) + fallidos };
  const estado = (pendientes ?? 0) === 0 ? 'completada' : 'enviando';
  await supabaseAdmin.from('difusiones').update({
    ...totales, estado, completada_en: estado === 'completada' ? new Date().toISOString() : null,
  }).eq('id', difusionId);

  return { estado, ...totales, total: dif.total, pendientes: pendientes ?? 0 };
}
