// ============================================
// FIRMA DE LOS AVISOS DE SHOPIFY (X-Shopify-Hmac-Sha256)
// ============================================
// Shopify firma con claves distintas según quién creó la suscripción:
//   - las que registró la app por API (productos, carritos, pedidos pagados y
//     despachados) con la clave secreta de la app (SHOPIFY_CLIENT_SECRET);
//   - las creadas en Configuración › Notificaciones del admin con la clave que
//     muestra esa pantalla (SHOPIFY_WEBHOOK_SECRET).
// Desde el 2026-10-30 el CRM solo aceptaba la segunda y rechazó ~3.700 avisos
// de la app. Se acepta cualquiera de las dos.

import crypto from 'crypto';

/** Claves con las que puede venir firmado un aviso (sin vacías ni repetidas). */
export function clavesWebhookShopify(env: Record<string, string | undefined> = process.env): string[] {
  const claves = [env.SHOPIFY_WEBHOOK_SECRET, env.SHOPIFY_CLIENT_SECRET].map((c) => (c || '').trim()).filter(Boolean);
  return Array.from(new Set(claves));
}

/** true si el cuerpo viene firmado por Shopify con alguna de las claves. */
export function firmaShopifyValida(cuerpo: string, hmac: string | null, claves: string[]): boolean {
  if (!hmac || !claves.length) return false;
  const recibido = Buffer.from(hmac);
  return claves.some((clave) => {
    const esperado = Buffer.from(crypto.createHmac('sha256', clave).update(cuerpo, 'utf8').digest('base64'));
    return esperado.length === recibido.length && crypto.timingSafeEqual(esperado, recibido);
  });
}
