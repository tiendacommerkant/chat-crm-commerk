// ============================================
// ENCUESTA DE SATISFACCIÓN
// ============================================
//
// Cuando un asesor marca un caso como resuelto, el cliente recibe una
// pregunta con tres botones. La respuesta queda en la tabla encuestas y
// alimenta el tablero de atención.

import { supabaseAdmin } from './supabase';
import { enviarMensajeConBotones } from './whatsapp';
import { leerConfiguracion } from './horario';
import { fusionarEstadoConversacion } from './estado';

export const BOTONES_ENCUESTA = [
  { id: 'csat_3', title: '😀 Excelente' },
  { id: 'csat_2', title: '🙂 Buena' },
  { id: 'csat_1', title: '😕 Mala' },
];

/** 3 = excelente, 2 = buena, 1 = mala; null si el texto no es una calificación. */
export function parsearCalificacion(texto: string): 1 | 2 | 3 | null {
  const t = texto.trim().toLowerCase();
  if (t.length > 40) return null;
  if (/😀|excelente|muy buena|super|súper|perfect|10\/10/.test(t)) return 3;
  if (/😕|mala|malo|regular|p[eé]sima|horrible/.test(t)) return 1;
  if (/🙂|buena|bueno|bien/.test(t)) return 2;
  return null;
}

const VENTANA_MS = 24 * 3_600_000;

/**
 * Envía la encuesta si: está activada, un asesor le escribió al cliente en
 * las últimas 24 h y la ventana de WhatsApp sigue abierta. Devuelve si se envió.
 */
export async function enviarEncuestaSiCorresponde(conversacionId: string): Promise<boolean> {
  const config = await leerConfiguracion();
  if (config.encuesta_activa === false) return false;

  const desde = new Date(Date.now() - VENTANA_MS).toISOString();
  const [{ data: conv }, { data: agente }, { data: ultimoCliente }] = await Promise.all([
    supabaseAdmin.from('conversaciones').select('id, cliente:clientes(telefono, nombre)').eq('id', conversacionId).maybeSingle(),
    supabaseAdmin.from('mensajes').select('metadata, created_at').eq('conversacion_id', conversacionId)
      .eq('metadata->>enviado_por', 'agente').gte('created_at', desde).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from('mensajes').select('created_at').eq('conversacion_id', conversacionId)
      .eq('tipo', 'user').gte('created_at', desde).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const cliente = (conv as any)?.cliente;
  if (!cliente?.telefono || !agente || !ultimoCliente) return false;

  const asesorNombre: string = (agente as any).metadata?.asesor_nombre || '';
  const nombre = (cliente.nombre || '').split(' ')[0];
  const texto = `¡Gracias por escribirnos${nombre ? `, ${nombre}` : ''}! 🙏\n\n` +
    `¿Cómo calificarías la atención${asesorNombre ? ` de ${asesorNombre.split(' ')[0]}` : ''} hoy?`;

  const envio = await enviarMensajeConBotones(cliente.telefono, texto, BOTONES_ENCUESTA);
  if (!envio.success) return false;

  await supabaseAdmin.from('mensajes').insert({
    conversacion_id: conversacionId,
    tipo: 'bot',
    contenido: texto,
    metadata: {
      tipo_wa: 'interactive',
      awaiting: 'encuesta',
      encuesta: true,
      encuesta_asesor: (agente as any).metadata?.asesor || null,
      encuesta_asesor_nombre: asesorNombre || null,
      whatsapp_message_id: envio.messageId,
    },
  });
  await fusionarEstadoConversacion(conversacionId, {
    awaiting: 'encuesta',
    encuesta_asesor: (agente as any).metadata?.asesor || null,
    encuesta_asesor_nombre: asesorNombre || null,
  });
  return true;
}
