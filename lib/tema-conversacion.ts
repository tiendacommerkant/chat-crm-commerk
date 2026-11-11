// ============================================
// TEMA PARA RETOMAR UNA CONVERSACIÓN
// ============================================
// La plantilla retomar_conversacion dice "…para continuar con tu consulta
// sobre {{2}}". El asesor no debería tener que escribir ese tema: se saca de
// los últimos mensajes del chat con la IA (p. ej. Juli Toro → "las 100
// anchetas con ron para tu empresa"). Si la IA no responde, un tema según el
// tipo de conversación; el asesor siempre lo puede corregir antes de enviar.
import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from './supabase';

const MENSAJES_A_LEER = 30;
const MAX_CARACTERES = 70;

export const TEMA_GENERAL = 'los productos que nos preguntaste';

export interface TemaSugerido {
  tema: string;
  origen: 'ia' | 'respaldo';
}

/** Tema cuando no hay IA: según la etiqueta o el motivo con que se pasó al asesor. */
export function temaDeRespaldo(conv: { etiqueta?: string | null; motivo_transferencia?: string | null } | null): string {
  const tipo = [conv?.etiqueta, conv?.motivo_transferencia];
  if (tipo.includes('empresarial')) return 'los regalos para tu empresa';
  if (tipo.includes('mayorista')) return 'tu compra al por mayor';
  return TEMA_GENERAL;
}

/**
 * Deja la respuesta de la IA lista para la plantilla: una sola línea corta,
 * sin comillas ni punto final. WhatsApp rechaza parámetros con saltos de
 * línea. null si no sirve.
 */
export function limpiarTema(texto: string | null | undefined): string | null {
  if (!texto) return null;
  let t = texto.replace(/\s+/g, ' ').trim();
  t = t.replace(/^(tema|respuesta)\s*:\s*/i, '');
  t = t.replace(/^["'«“]+|["'»”]+$/g, '').trim();
  t = t.replace(/[.!¡¿?,;:]+$/g, '').trim();
  if (t.length < 3 || t.length > MAX_CARACTERES) return null;
  if (/[{}]|https?:\/\//i.test(t)) return null;
  // Va en mitad de la frase: "…tu consulta sobre las anchetas…"
  if (/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]/.test(t) && /^(El|La|Los|Las|Tu|Tus|Un|Una|Unos|Unas|Su|Sus)\b/.test(t)) {
    t = t[0].toLowerCase() + t.slice(1);
  }
  return t;
}

/** Los últimos mensajes como texto para la IA (más antiguo primero). */
export function transcripcion(mensajes: Array<{ tipo: string; contenido: string | null }>): string {
  return mensajes
    .filter((m) => (m.contenido || '').trim())
    .map((m) => `${m.tipo === 'user' ? 'Cliente' : 'Tienda'}: ${String(m.contenido).replace(/\s+/g, ' ').trim().slice(0, 300)}`)
    .join('\n');
}

const INSTRUCCIONES = `Lees un chat de WhatsApp de Tienda Commerk Antioquia (licores, anchetas, kits y regalos) con un cliente.
Un asesor le va a escribir: "Hola, te escribimos de Tienda Commerk Antioquia para continuar con tu consulta sobre ___."
Responde SOLO con lo que va en el espacio: el tema concreto de lo que el cliente quería.
- Máximo 8 palabras, en español, hablándole al cliente (tu, tus).
- Empieza en minúscula (es mitad de frase). Sin comillas, sin punto final, sin saludo.
- Nombra el producto o pedido si se sabe. Sin precios, teléfonos, direcciones ni correos.
Ejemplos: tu pedido del Ron Viejo de Caldas · las 100 anchetas con ron para tu empresa · el Kit Ejecutivo que te interesó · el pago de tu pedido`;

let cliente: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!cliente) cliente = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return cliente;
}

async function temaConIA(texto: string): Promise<string | null> {
  const respuesta = await anthropic().beta.messages.create(
    {
      model: 'claude-opus-5-5',
      max_tokens: 2048,
      // Tarea corta: esfuerzo bajo responde en pocos segundos
      output_config: { effort: 'low' },
      // Si el modelo declina, el servidor lo reintenta con otro modelo
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: INSTRUCCIONES,
      messages: [{ role: 'user', content: `Chat:\n${texto}` }],
    },
    // El asesor está esperando con la ventana abierta: sin margen largo
    { timeout: 15_000, maxRetries: 1 }
  );
  if (respuesta.stop_reason === 'refusal') return null;
  const salida = respuesta.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join(' ');
  return limpiarTema(salida);
}

/** Tema sugerido para la plantilla retomar_conversacion de una conversación. */
export async function sugerirTemaConversacion(conversacionId: string): Promise<TemaSugerido> {
  const [{ data: conv }, { data: mensajes }] = await Promise.all([
    supabaseAdmin.from('conversaciones').select('etiqueta, motivo_transferencia').eq('id', conversacionId).maybeSingle(),
    supabaseAdmin.from('mensajes').select('tipo, contenido')
      .eq('conversacion_id', conversacionId)
      .order('created_at', { ascending: false })
      .limit(MENSAJES_A_LEER),
  ]);
  const respaldo: TemaSugerido = { tema: temaDeRespaldo(conv as any), origen: 'respaldo' };

  const texto = transcripcion(((mensajes as any[]) || []).slice().reverse());
  if (!texto || !process.env.ANTHROPIC_API_KEY) return respaldo;
  try {
    const tema = await temaConIA(texto);
    return tema ? { tema, origen: 'ia' } : respaldo;
  } catch (e: any) {
    console.error('[Tema plantilla] La IA no respondió:', e?.message);
    return respaldo;
  }
}
