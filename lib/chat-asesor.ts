// ============================================
// CHAT DEL ASESOR — lo común a responder con texto, archivo o plantilla
// ============================================

import { supabaseAdmin } from './supabase';
import { tomarConversacion, type Asesor } from './atencion';

export interface DestinoChat {
  conversacionId: string;
  clienteId: string;
  telefono: string;
  nombre: string | null;
  estadoAtencion: string | null;
  asignadoA: string | null;
}

/** Conversación y teléfono del cliente; null si no existe o no tiene teléfono. */
export async function obtenerDestino(conversacionId: string): Promise<DestinoChat | null> {
  const { data } = await supabaseAdmin
    .from('conversaciones')
    .select('*, cliente:clientes(id, telefono, nombre)')
    .eq('id', conversacionId)
    .maybeSingle();
  const cliente = (data as any)?.cliente;
  if (!data || !cliente?.telefono) return null;
  return {
    conversacionId,
    clienteId: cliente.id,
    telefono: cliente.telefono,
    nombre: cliente.nombre || null,
    estadoAtencion: (data as any).estado_atencion ?? null,
    asignadoA: (data as any).asignado_a ?? null,
  };
}

/**
 * Guarda el mensaje del asesor con su firma. Responder es tomar la
 * conversación: el bot deja de contestar para no hablar encima del asesor,
 * y si estaba pendiente sale de la bandeja con este asesor asignado.
 */
export async function registrarMensajeAsesor(
  destino: DestinoChat,
  contenido: string,
  metadata: Record<string, any>,
  asesor: Asesor
) {
  const { data } = await supabaseAdmin
    .from('mensajes')
    .insert({
      conversacion_id: destino.conversacionId,
      tipo: 'bot',
      contenido,
      metadata: { ...metadata, enviado_por: 'agente', asesor: asesor.email, asesor_nombre: asesor.nombre },
    })
    .select()
    .single();

  if (destino.estadoAtencion !== 'en_atencion' || !destino.asignadoA) {
    await tomarConversacion(destino.conversacionId, asesor);
  } else {
    await supabaseAdmin.from('conversaciones')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', destino.conversacionId);
  }
  return data;
}

/** Errores de WhatsApp en lenguaje del asesor. */
export function traducirErrorWhatsApp(error?: string): string {
  const e = error || '';
  if (/24 ?hours|re-?engagement|131047|more than 24/i.test(e)) {
    return 'Pasaron más de 24 horas desde el último mensaje del cliente. WhatsApp solo permite escribirle con una plantilla.';
  }
  if (/131026|undeliverable|not a valid whatsapp/i.test(e)) return 'Este número no puede recibir mensajes de WhatsApp.';
  if (/131051|unsupported/i.test(e)) return 'WhatsApp no acepta este tipo de archivo.';
  return e || 'WhatsApp no aceptó el mensaje.';
}
