// ============================================
// FIRMA DE LOS EVENTOS DE WOMPI
// ============================================
// Según https://docs.wompi.co/docs/colombia/eventos/ el checksum es el SHA256
// de: los valores de signature.properties (rutas DENTRO de "data", en su
// orden) + el "timestamp" entero del evento + el secreto de eventos.
// Antes se buscaban las propiedades en la raíz del evento y se usaba
// "sent_at": ningún evento real pasaba la verificación y el bot nunca
// confirmó un pago (ni creó el pedido en Shopify).

import crypto from 'crypto';

interface EventoFirmado {
  data?: Record<string, any>;
  timestamp?: number | string;
  signature?: { properties?: string[]; checksum?: string };
}

export function checksumWompi(evento: EventoFirmado, secreto: string): string {
  const valores = (evento.signature?.properties || []).map((ruta) =>
    String(ruta.split('.').reduce<any>((obj, clave) => obj?.[clave], evento.data) ?? ''));
  return crypto.createHash('sha256').update(valores.join('') + String(evento.timestamp ?? '') + secreto).digest('hex');
}

/** true si el evento viene firmado por Wompi con este secreto. */
export function firmaWompiValida(evento: EventoFirmado, secreto: string): boolean {
  const recibido = String(evento.signature?.checksum || '').toLowerCase();
  if (!secreto || !recibido || !evento.signature?.properties?.length || evento.timestamp == null) return false;
  const esperado = checksumWompi(evento, secreto);
  return esperado.length === recibido.length && crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(recibido));
}
