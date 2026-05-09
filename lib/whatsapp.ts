// ============================================
// WHATSAPP BUSINESS API CLIENT
// ============================================

import type { WhatsAppSendMessagePayload } from '@/types';

const WHATSAPP_API_URL = 'https://graph.facebook.com/v18.0';
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID!;
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN!;

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
      to: to.replace('+', ''), // Remover + si existe
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
      to: to.replace('+', ''),
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
      to: to.replace('+', ''),
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
