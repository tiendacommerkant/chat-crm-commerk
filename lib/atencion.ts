// ============================================
// ATENCIÓN HUMANA — bandeja de pendientes y asignación de asesores
// ============================================
//
// Antes, cuando el bot pasaba una conversación a una persona solo se apagaba
// (bot_activo = false): no quedaba en ninguna bandeja, nadie recibía aviso y
// en octubre hubo clientes que se quedaron sin respuesta. Ahora la
// conversación tiene un estado de atención:
//   bot          → la atiende Sofi
//   pendiente    → espera a un asesor (aparece en "Pendientes" con su tiempo)
//   en_atencion  → un asesor la tomó; el bot no responde
//
// Si la migración de atención aún no se corrió, todo se reduce a bot_activo
// como antes, para no romper la operación.

import { supabaseAdmin } from './supabase';

export type EstadoAtencion = 'bot' | 'pendiente' | 'en_atencion';

export interface Asesor {
  email: string;
  nombre: string;
}

const COLUMNAS_NUEVAS = /estado_atencion|asignado_a|asignado_nombre|pendiente_desde|atendido_desde|motivo_transferencia/;

async function actualizarConversacion(id: string, cambios: Record<string, any>): Promise<void> {
  const { error } = await supabaseAdmin
    .from('conversaciones')
    .update({ ...cambios, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (!error) return;
  if (COLUMNAS_NUEVAS.test(error.message)) {
    // Migración pendiente: se aplica al menos el encendido/apagado del bot
    if ('bot_activo' in cambios) {
      await supabaseAdmin.from('conversaciones')
        .update({ bot_activo: cambios.bot_activo, updated_at: new Date().toISOString() })
        .eq('id', id);
    }
    return;
  }
  console.error('[Atención] No se pudo actualizar la conversación', id, error.message);
}

async function leerEstado(id: string): Promise<Record<string, any> | null> {
  const { data } = await supabaseAdmin.from('conversaciones').select('*').eq('id', id).maybeSingle();
  return data;
}

/** El bot pasa la conversación a un asesor: entra a "Pendientes". */
export async function pasarAPendiente(id: string, motivo: string): Promise<void> {
  const actual = await leerEstado(id);
  // Si un asesor ya la tiene, sigue con él
  if (actual?.estado_atencion === 'en_atencion') {
    await actualizarConversacion(id, { bot_activo: false });
    return;
  }
  await actualizarConversacion(id, {
    bot_activo: false,
    estado_atencion: 'pendiente',
    // El reloj de espera no se reinicia si ya estaba pendiente
    pendiente_desde: actual?.estado_atencion === 'pendiente' && actual?.pendiente_desde
      ? actual.pendiente_desde
      : new Date().toISOString(),
    motivo_transferencia: motivo,
  });
}

/** Un asesor toma la conversación: el bot deja de responder. */
export async function tomarConversacion(id: string, asesor: Asesor): Promise<void> {
  const actual = await leerEstado(id);
  await actualizarConversacion(id, {
    bot_activo: false,
    estado_atencion: 'en_atencion',
    asignado_a: asesor.email,
    asignado_nombre: asesor.nombre,
    atendido_desde: actual?.atendido_desde || new Date().toISOString(),
  });
}

/** Asigna la conversación a otro asesor sin cambiar quién la atiende ahora. */
export async function asignarConversacion(id: string, asesor: Asesor): Promise<void> {
  await actualizarConversacion(id, {
    bot_activo: false,
    estado_atencion: 'en_atencion',
    asignado_a: asesor.email,
    asignado_nombre: asesor.nombre,
  });
}

/** La conversación vuelve a Sofi (caso resuelto o el asesor la libera). */
export async function devolverAlBot(id: string): Promise<void> {
  await actualizarConversacion(id, {
    bot_activo: true,
    estado_atencion: 'bot',
    asignado_a: null,
    asignado_nombre: null,
    pendiente_desde: null,
    atendido_desde: null,
    motivo_transferencia: null,
  });
}

/** Motivo legible para la bandeja. */
export const MOTIVOS_TRANSFERENCIA: Record<string, string> = {
  cliente_pidio_asesor: 'Pidió hablar con un asesor',
  mayorista: 'Compra al por mayor',
  pago: 'Ayuda con el pago',
  sofi: 'Sofi no pudo resolver',
  manual: 'Tomada por un asesor',
};
