// ============================================
// WOMPI API CLIENT (Pasarela de Pagos Colombia)
// ============================================

import type { WompiPaymentLink, WompiTransaction } from '@/types';
import crypto from 'crypto';

const WOMPI_API_URL = 'https://production.wompi.co/v1';
const WOMPI_PUBLIC_KEY = process.env.WOMPI_PUBLIC_KEY!;
const WOMPI_PRIVATE_KEY = process.env.WOMPI_PRIVATE_KEY!;
const WOMPI_EVENT_SECRET = process.env.WOMPI_EVENT_SECRET!;

/**
 * Generar link de pago de Wompi
 */
export async function generarLinkPagoWompi(params: {
  nombre: string;
  descripcion: string;
  monto: number; // en COP
  referencia: string;
  emailCliente?: string;
  urlRedireccion?: string;
}): Promise<{ success: boolean; link?: string; error?: string }> {
  try {
    const montoEnCentavos = Math.round(params.monto * 100);

    const payload = {
      name: params.nombre,
      description: params.descripcion,
      single_use: true,
      collect_shipping: false,
      amount_in_cents: montoEnCentavos,
      currency: 'COP',
      // Al terminar de pagar vuelve al chat, donde le llega la confirmación con
      // el número de pedido (antes iba a /pago/confirmacion, que no existe: 404)
      redirect_url: params.urlRedireccion || `https://wa.me/${process.env.WHATSAPP_NUMERO_TIENDA || '573174644945'}`,
    };

    console.log('[Wompi] KEY presente:', !!WOMPI_PRIVATE_KEY, '| monto COP:', params.monto, '| centavos:', montoEnCentavos);

    const response = await fetch(`${WOMPI_API_URL}/payment_links`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WOMPI_PRIVATE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    console.log('[Wompi] HTTP status:', response.status);

    if (!response.ok) {
      const error = await response.json();
      console.error('[Wompi] Error body:', JSON.stringify(error));
      const detalle =
        error.error?.messages
          ? Object.values(error.error.messages).flat().join(', ')
          : error.error?.reason || error.message || `HTTP ${response.status}`;
      return { success: false, error: String(detalle) };
    }

    const rawData = await response.json();
    const data = rawData as { data: WompiPaymentLink & { id: string } };

    // Wompi no devuelve permalink — se construye con el id del link
    const link = data.data?.permalink || `https://checkout.wompi.co/l/${data.data?.id}`;
    console.log('[Wompi] link generado:', link);

    return {
      success: true,
      link,
    };
  } catch (error) {
    console.error('Error en generarLinkPagoWompi:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error desconocido',
    };
  }
}

/**
 * Verificar firma de webhook de Wompi
 */
export function verificarFirmaWompi(
  body: string,
  signature: string,
  timestamp: string
): boolean {
  try {
    const payload = `${timestamp}.${body}`;
    const expectedSignature = crypto
      .createHmac('sha256', WOMPI_EVENT_SECRET)
      .update(payload)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch (error) {
    console.error('Error verificando firma Wompi:', error);
    return false;
  }
}

/**
 * Obtener detalles de una transacción
 */
export async function obtenerTransaccionWompi(
  transactionId: string
): Promise<WompiTransaction | null> {
  try {
    const response = await fetch(
      `${WOMPI_API_URL}/transactions/${transactionId}`,
      {
        headers: {
          'Authorization': `Bearer ${WOMPI_PUBLIC_KEY}`,
        },
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Error obteniendo transacción:', error);
    return null;
  }
}

/**
 * Pago aprobado de un link del bot, consultando Wompi directamente. Los links
 * no llevan nuestra referencia (Wompi les pone la suya), así que se listan las
 * transacciones desde que se creó el link y se filtra por payment_link_id.
 * Red de seguridad para cuando el cliente dice "ya pagué" y el webhook no llegó.
 */
export async function buscarPagoAprobadoDeLink(linkPago: string, creadoEn: string): Promise<WompiTransaction | null> {
  const linkId = linkPago.split('/').pop();
  if (!linkId) return null;
  const dia = (d: Date) => d.toISOString().slice(0, 10);
  const desde = dia(new Date(creadoEn));
  const hasta = dia(new Date(Date.now() + 864e5));
  for (let page = 1; page <= 6; page++) {
    const r = await fetch(`${WOMPI_API_URL}/transactions?from_date=${desde}&until_date=${hasta}&page=${page}&page_size=50`, {
      headers: { Authorization: `Bearer ${WOMPI_PRIVATE_KEY}` }, cache: 'no-store',
    });
    if (!r.ok) return null;
    const j = await r.json();
    const lista: WompiTransaction[] = j.data || [];
    const aprobada = lista.find((t: any) => t.payment_link_id === linkId && t.status === 'APPROVED');
    if (aprobada) return aprobada;
    if (lista.length < 50) break;
  }
  return null;
}
