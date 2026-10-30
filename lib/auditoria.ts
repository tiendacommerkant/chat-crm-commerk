// ============================================
// REGISTRO DE ACTIVIDAD — quién hizo qué en el CRM
// ============================================

import { supabaseAdmin } from './supabase';
import { asesorDeRequest } from './sesion';

export interface Actor { email: string; nombre: string }

export const SISTEMA: Actor = { email: 'sistema', nombre: 'Sistema' };

/**
 * Registra una acción. Nunca lanza error ni frena la operación: si la tabla
 * aún no existe (migración pendiente) solo queda en el log.
 */
export async function auditar(
  actor: Actor | null,
  accion: string,
  entidad: string | null,
  entidadId: string | null,
  detalle?: Record<string, any>
): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from('auditoria').insert({
      actor: actor?.email || 'desconocido',
      actor_nombre: actor?.nombre || null,
      accion,
      entidad,
      entidad_id: entidadId,
      detalle: detalle ?? null,
    });
    if (error && !/auditoria/.test(error.message)) console.warn('[Auditoría]', error.message);
  } catch {
    /* no frena la operación */
  }
}

/** Atajo para las rutas de la API: toma el actor de la sesión. */
export async function auditarRequest(req: Request, accion: string, entidad: string | null, entidadId: string | null, detalle?: Record<string, any>) {
  await auditar(await asesorDeRequest(req), accion, entidad, entidadId, detalle);
}

/** Nombre legible de cada acción para la página de actividad. */
export const ACCIONES: Record<string, string> = {
  'sesion.ingreso': 'Inició sesión',
  'conversacion.tomar': 'Tomó una conversación',
  'conversacion.asignar': 'Asignó una conversación',
  'conversacion.resolver': 'Marcó como resuelta',
  'conversacion.bot': 'Encendió o apagó el bot',
  'conversacion.etiqueta': 'Cambió la etiqueta',
  'conversacion.nueva': 'Inició una conversación',
  'mensaje.texto': 'Respondió a un cliente',
  'mensaje.adjunto': 'Envió un archivo',
  'mensaje.plantilla': 'Envió una plantilla',
  'nota.crear': 'Escribió una nota interna',
  'respuesta_rapida.crear': 'Creó una respuesta rápida',
  'respuesta_rapida.editar': 'Editó una respuesta rápida',
  'respuesta_rapida.borrar': 'Borró una respuesta rápida',
  'equipo.crear': 'Creó una cuenta',
  'equipo.editar': 'Editó una cuenta',
  'configuracion.editar': 'Cambió la configuración',
  'oportunidad.crear': 'Creó una oportunidad',
  'oportunidad.editar': 'Editó una oportunidad',
  'oportunidad.etapa': 'Movió una oportunidad de etapa',
  'difusion.crear': 'Creó una difusión',
  'difusion.enviar': 'Envió una difusión',
  'difusion.cancelar': 'Canceló una difusión',
  'catalogo.sincronizar': 'Sincronizó el catálogo',
  'carritos.campana': 'Programó una campaña de carritos',
  'lead.actualizar': 'Actualizó un lead mayorista',
  'carritos.campana_cancelar': 'Canceló la campaña de carritos',
  'plantilla.crear': 'Creó una plantilla de WhatsApp',
  'plantilla.borrar': 'Borró una plantilla de WhatsApp',
  'datos.borrar_todo': 'Borró todos los datos',
};
