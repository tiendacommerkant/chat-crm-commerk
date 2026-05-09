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
      redirect_url: params.urlRedireccion || `${process.env.NEXT_PUBLIC_BASE_URL}/pago/confirmacion?ref=${params.referencia}`,
    };

    const response = await fetch(`${WOMPI_API_URL}/payment_links`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WOMPI_PRIVATE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('Error generando link Wompi:', error);
      return {
        success: false,
        error: error.error?.reason || 'Error desconocido',
      };
    }

    const data: { data: WompiPaymentLink } = await response.json();
    
    return {
      success: true,
      link: data.data.permalink,
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
