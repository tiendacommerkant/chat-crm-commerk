// ============================================
// WHATSAPP BUSINESS API CLIENT
// ============================================

import type { WhatsAppSendMessagePayload } from '@/types';
import { esIdUsuarioWhatsApp } from './whatsapp-id';

// v18 ya está descontinuada: Meta la redirigía en silencio a v25. Se fija la
// versión vigente para no depender de esa redirección (y para el campo
// `recipient` de clientes con nombre de usuario).
export const WHATSAPP_GRAPH_VERSION = 'v25.0';
const WHATSAPP_API_URL = `https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}`;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID!;
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN!;

export { esIdUsuarioWhatsApp };

/**
 * Destinatario para la API de mensajes: número (`to`) o, para clientes que
 * usan nombre de usuario y ocultan su número, su ID de usuario (`recipient`).
 */
export function destinatarioWhatsApp(
  id: string
): { to: string } | { recipient_type: 'individual'; recipient: string } {
  const limpio = id.trim();
  return esIdUsuarioWhatsApp(limpio)
    ? { recipient_type: 'individual', recipient: limpio }
    : { to: limpio.replace('+', '') };
}

/**
 * Enviar mensaje de texto a un número de WhatsApp
 */
export async function enviarMensajeWhatsApp(
  to: string,
  mensaje: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const payload: WhatsAppSendMessagePayload = {
      messaging_product: 'whatsapp',
      ...destinatarioWhatsApp(to),
      type: 'text',
      text: {
        body: mensaje,
      },
    };

    const response = await fetch(
      `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      console.error('Error enviando mensaje WhatsApp:', error);
      return {
        success: false,
        error: error.error?.message || 'Error desconocido',
      };
    }

    const data = await response.json();
    return {
      success: true,
      messageId: data.messages?.[0]?.id,
    };
  } catch (error) {
    console.error('Error en enviarMensajeWhatsApp:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error desconocido',
    };
  }
}

const MAX_IMAGEN_WHATSAPP = 5 * 1024 * 1024;

/**
 * Descarga la foto y la sube a WhatsApp; devuelve el media ID (o null).
 * WhatsApp solo acepta JPG/PNG de hasta 5 MB, y el CDN de Shopify entrega
 * WebP a quien lo acepte —como los servidores de Meta— aunque la URL diga
 * otra cosa; además hay fotos de producto en PNG de casi 5 MB. Al mandar solo
 * el link, Meta aceptaba el mensaje y luego la foto no llegaba (ni el texto
 * que iba como pie de foto). Aquí se pide JPG/PNG a 1200 px y se sube.
 */
export async function subirImagenWhatsApp(imageUrl: string): Promise<string | null> {
  const url = new URL(imageUrl);
  if (url.hostname.endsWith('shopify.com') || url.pathname.includes('/cdn/shop/')) {
    url.searchParams.set('width', '1200');
  }
  const res = await fetch(url, { headers: { Accept: 'image/jpeg,image/png' } });
  if (!res.ok) {
    console.error(`[WA] No se pudo descargar la foto (${res.status}):`, imageUrl);
    return null;
  }
  const tipo = (res.headers.get('content-type') || '').split(';')[0].trim();
  const datos = await res.arrayBuffer();
  if ((tipo !== 'image/jpeg' && tipo !== 'image/png') || datos.byteLength > MAX_IMAGEN_WHATSAPP) {
    console.error(`[WA] Foto no apta para WhatsApp (${tipo}, ${datos.byteLength} bytes):`, imageUrl);
    return null;
  }

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', tipo);
  form.append('file', new Blob([datos], { type: tipo }), tipo === 'image/png' ? 'producto.png' : 'producto.jpg');
  const subida = await fetch(`${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/media`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` },
    body: form,
  });
  const data = await subida.json().catch(() => ({}));
  if (!subida.ok || !data.id) {
    console.error('[WA] Error subiendo la foto a WhatsApp:', data?.error?.message || subida.status);
    return null;
  }
  return data.id;
}

/**
 * Enviar una foto de producto (viene de Shopify, cacheada como imagen_url).
 * Antes Sofi decía "no puedo mandar fotos" y conectaba con un asesor que casi
 * nunca respondía a tiempo, dejando al cliente sin la imagen. Ya la tenemos.
 */
export async function enviarImagenWhatsApp(
  to: string,
  imageUrl: string,
  caption?: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    // Si la subida falla, se intenta con el link como antes
    const mediaId = await subirImagenWhatsApp(imageUrl).catch((e) => {
      console.error('[WA] Falló la subida de la foto, se envía por link:', e?.message);
      return null;
    });
    const response = await fetch(
      `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          ...destinatarioWhatsApp(to),
          type: 'image',
          image: mediaId ? { id: mediaId, caption: caption || '' } : { link: imageUrl, caption: caption || '' },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      console.error('Error enviando imagen WhatsApp:', error);
      return { success: false, error: error.error?.message || 'Error desconocido' };
    }

    const data = await response.json();
    return { success: true, messageId: data.messages?.[0]?.id };
  } catch (error) {
    console.error('Error en enviarImagenWhatsApp:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Error desconocido' };
  }
}

// Tipos de archivo que un asesor puede mandar desde el CRM y su límite en WhatsApp
export const ARCHIVOS_PERMITIDOS: Record<string, { tipo: 'image' | 'document'; maxBytes: number }> = {
  'image/jpeg': { tipo: 'image', maxBytes: MAX_IMAGEN_WHATSAPP },
  'image/png': { tipo: 'image', maxBytes: MAX_IMAGEN_WHATSAPP },
  'application/pdf': { tipo: 'document', maxBytes: 16 * 1024 * 1024 },
};

/**
 * Sube un archivo (foto o PDF que adjunta un asesor) y devuelve el media ID.
 * El mismo ID sirve para verlo luego en el CRM a través de /api/wa-media.
 */
export async function subirArchivoWhatsApp(
  datos: ArrayBuffer,
  mime: string,
  nombreArchivo: string
): Promise<{ id?: string; error?: string }> {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mime);
  form.append('file', new Blob([datos], { type: mime }), nombreArchivo);
  const res = await fetch(`${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/media`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) return { error: data?.error?.message || `HTTP ${res.status}` };
  return { id: data.id };
}

/** Envía una foto o un documento ya subido (media ID). */
export async function enviarArchivoWhatsApp(
  to: string,
  tipo: 'image' | 'document',
  mediaId: string,
  opciones: { caption?: string; filename?: string } = {}
): Promise<{ success: boolean; messageId?: string; error?: string; codigo?: number }> {
  const contenido: Record<string, string> = { id: mediaId };
  if (opciones.caption) contenido.caption = opciones.caption;
  if (tipo === 'document' && opciones.filename) contenido.filename = opciones.filename;
  const res = await fetch(`${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...destinatarioWhatsApp(to), type: tipo, [tipo]: contenido }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { success: false, error: data?.error?.message || `HTTP ${res.status}`, codigo: data?.error?.code };
  return { success: true, messageId: data.messages?.[0]?.id };
}

/**
 * Envía cualquier plantilla aprobada. Es lo único que WhatsApp permite
 * mandarle a un cliente que no ha escrito en las últimas 24 horas.
 */
export async function enviarPlantillaWhatsApp(
  to: string,
  nombre: string,
  idioma: string,
  components: any[]
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const res = await fetch(`${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      ...destinatarioWhatsApp(to),
      type: 'template',
      template: { name: nombre, language: { code: idioma }, components },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { success: false, error: data?.error?.message || `HTTP ${res.status}` };
  return { success: true, messageId: data.messages?.[0]?.id };
}

/**
 * Marcar mensaje como leído
 */
export async function marcarComoLeido(messageId: string): Promise<boolean> {
  try {
    const response = await fetch(
      `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId,
        }),
      }
    );

    return response.ok;
  } catch (error) {
    console.error('Error marcando mensaje como leído:', error);
    return false;
  }
}

/**
 * Enviar mensaje con botones interactivos
 */
export async function enviarMensajeConBotones(
  to: string,
  texto: string,
  botones: Array<{ id: string; title: string }>
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    if (botones.length > 3) {
      throw new Error('WhatsApp solo permite hasta 3 botones');
    }

    const payload = {
      messaging_product: 'whatsapp',
      ...destinatarioWhatsApp(to),
      type: 'interactive',
      interactive: {
        type: 'button',
        body: {
          text: texto,
        },
        action: {
          buttons: botones.map((btn) => ({
            type: 'reply',
            reply: {
              id: btn.id,
              title: btn.title.substring(0, 20), // Max 20 caracteres
            },
          })),
        },
      },
    };

    const response = await fetch(
      `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      console.error('Error enviando mensaje con botones:', error);
      return {
        success: false,
        error: error.error?.message || 'Error desconocido',
      };
    }

    const data = await response.json();
    return {
      success: true,
      messageId: data.messages?.[0]?.id,
    };
  } catch (error) {
    console.error('Error en enviarMensajeConBotones:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error desconocido',
    };
  }
}

/**
 * Enviar mensaje con lista de opciones
 */
export async function enviarMensajeConLista(
  to: string,
  textoHeader: string,
  textoBody: string,
  botonTexto: string,
  secciones: Array<{
    title: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  }>
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const payload = {
      messaging_product: 'whatsapp',
      ...destinatarioWhatsApp(to),
      type: 'interactive',
      interactive: {
        type: 'list',
        header: {
          type: 'text',
          text: textoHeader,
        },
        body: {
          text: textoBody,
        },
        action: {
          button: botonTexto,
          sections: secciones,
        },
      },
    };

    const response = await fetch(
      `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      console.error('Error enviando mensaje con lista:', error);
      return {
        success: false,
        error: error.error?.message || 'Error desconocido',
      };
    }

    const data = await response.json();
    return {
      success: true,
      messageId: data.messages?.[0]?.id,
    };
  } catch (error) {
    console.error('Error en enviarMensajeConLista:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error desconocido',
    };
  }
}

/**
 * Formatear número de teléfono para WhatsApp
 * Ejemplo: "+57 318 334 9171" -> "573183349171"
 */
export function formatearNumeroWhatsApp(numero: string): string {
  // Un ID de usuario (cliente con nombre de usuario) no es un número: quitarle
  // los no-dígitos lo destruiría ("CO.1349..." → "1349...").
  if (esIdUsuarioWhatsApp(numero)) return numero.trim();

  // Remover todos los caracteres que no sean dígitos
  let limpio = numero.replace(/\D/g, '');
  
  // Si empieza con 57 (Colombia), asegurar que tenga 12 dígitos
  if (limpio.startsWith('57') && limpio.length === 12) {
    return limpio;
  }
  
  // Si es un número de 10 dígitos (celular colombiano sin código país)
  if (limpio.length === 10 && limpio.startsWith('3')) {
    return '57' + limpio;
  }
  
  return limpio;
}

/**
 * Validar formato de número de WhatsApp
 */
export function esNumeroWhatsAppValido(numero: string): boolean {
  const limpio = formatearNumeroWhatsApp(numero);
  
  // Debe tener entre 10 y 15 dígitos
  return limpio.length >= 10 && limpio.length <= 15;
}
