// ============================================
// ESTADO DE LA CONVERSACIÓN CON EL BOT
// ============================================
//
// El paso en que va el cliente (awaiting) y su carrito (pending_*) se leían
// del último mensaje del bot. Cualquier mensaje intermedio lo borraba: la
// respuesta de un asesor, un recordatorio automático de pago o el acuse de un
// sticker dejaban "awaiting" vacío y el bot olvidaba el carrito. Ahora el
// estado vive en su propia tabla y solo lo cambian las respuestas del bot.
// Si la tabla aún no existe, todo funciona como antes.

import { supabaseAdmin } from './supabase';

export interface EstadoGuardado {
  datos: Record<string, any>;
  updated_at: string;
}

// Lo que es del mensaje y no del estado de la conversación
const NO_ES_ESTADO = new Set(['tipo_wa', 'whatsapp_message_id', 'imagenes', 'estado_wa', 'error_wa', 'transferido_a_asesor', 'fuera_de_horario']);

export function extraerEstado(metadata: Record<string, any> | null | undefined): Record<string, any> {
  const estado: Record<string, any> = {};
  for (const [k, v] of Object.entries(metadata || {})) if (!NO_ES_ESTADO.has(k)) estado[k] = v;
  if (!('awaiting' in estado)) estado.awaiting = '';
  return estado;
}

export async function leerEstadoConversacion(conversacionId: string): Promise<EstadoGuardado | null> {
  const { data, error } = await supabaseAdmin
    .from('estado_conversacion').select('estado, updated_at').eq('conversacion_id', conversacionId).maybeSingle();
  if (error || !data) return null;
  return { datos: (data as any).estado || {}, updated_at: (data as any).updated_at };
}

/** Reemplaza el estado con el de la respuesta del bot. */
export async function guardarEstadoConversacion(conversacionId: string, metadata: Record<string, any> | null | undefined): Promise<void> {
  const { error } = await supabaseAdmin.from('estado_conversacion').upsert({
    conversacion_id: conversacionId,
    estado: extraerEstado(metadata),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'conversacion_id' });
  if (error && !/estado_conversacion/.test(error.message)) console.warn('[Estado]', error.message);
}

/** Cambia solo algunas claves (ej. la encuesta) sin perder el carrito. */
export async function fusionarEstadoConversacion(conversacionId: string, cambios: Record<string, any>): Promise<void> {
  const actual = await leerEstadoConversacion(conversacionId);
  await guardarEstadoConversacion(conversacionId, { ...(actual?.datos || {}), ...cambios });
}
