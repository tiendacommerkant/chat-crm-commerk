// ============================================
// IMÁGENES DEL CLIENTE PARA SOFI
// ============================================
// Caso Nora (16 nov): Sofi le pidió "mándame la foto de la publicación", ella
// mandó el pantallazo y el bot contestó con un mensaje fijo ("Recibí tu
// imagen…"); Sofi nunca la vio y terminó diciendo "no logro ver bien la foto"
// hasta que la clienta pidió un asesor. La IA sí lee imágenes: aquí se
// descarga la foto de WhatsApp para pasársela junto con el mensaje.
import { WHATSAPP_GRAPH_VERSION } from './whatsapp';
import type { Mensaje } from '@/types';

export interface ImagenCliente {
  media_type: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  /** Imagen en base64 */
  data: string;
}

const TIPOS_IA = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
// La IA acepta hasta 5 MB por imagen ya en base64 (que pesa ~4/3 del original)
const MAX_BYTES = 3_700_000;
// "Foto + ¿cuánto vale?" llega en dos mensajes: la pregunta se responde mirando la foto
const MINUTOS_FOTO_RECIENTE = 10;

/** Descarga una imagen que mandó el cliente. null si no se puede o no es un formato que la IA lea. */
export async function descargarImagenWhatsApp(mediaId: string, timeoutMs = 8000): Promise<ImagenCliente | null> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!mediaId || !token) return null;
  try {
    const meta = await fetch(`https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
    if (!meta.ok) return null;
    const info = await meta.json();
    const tipo = String(info.mime_type || '').split(';')[0].trim().toLowerCase();
    if (!TIPOS_IA.includes(tipo) || !info.url || Number(info.file_size) > MAX_BYTES) return null;

    const archivo = await fetch(info.url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
    if (!archivo.ok) return null;
    const bytes = Buffer.from(await archivo.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_BYTES) return null;
    return { media_type: tipo as ImagenCliente['media_type'], data: bytes.toString('base64') };
  } catch (e: any) {
    console.error('[Imagen] No se pudo descargar la imagen del cliente:', e?.message);
    return null;
  }
}

/**
 * Foto que el cliente mandó justo antes de este mensaje (en los últimos 10
 * minutos), para responder "¿cuánto vale?" o "ese mismo" mirándola. El
 * historial viene del más viejo al más nuevo e incluye el mensaje actual.
 */
export function fotoAnteriorDelCliente(historial: Mensaje[], ahora = Date.now()): string | null {
  const delCliente = historial.filter((m) => m.tipo === 'user');
  const anterior = delCliente[delCliente.length - 2];
  const mediaId = anterior?.metadata?.media_id;
  if (!anterior || !mediaId || !String(anterior.metadata?.media_mime_type || 'image/').startsWith('image/')) return null;
  const minutos = (ahora - new Date(anterior.created_at).getTime()) / 60_000;
  return minutos <= MINUTOS_FOTO_RECIENTE ? String(mediaId) : null;
}
