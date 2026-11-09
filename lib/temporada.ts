// ============================================
// TEMPORADA NOV-DIC 2026 — Black Week y gorra de regalo
// ============================================
// Lo mismo que anuncia la tienda online (barra superior, contador y página de
// la gorra). Sofi lo cuenta igual y los pedidos del bot también llevan la gorra.

import { obtenerProductoShopify } from './shopify';

export const BLACK_WEEK = { inicio: '2026-11-23', fin: '2026-11-30' };

export const REGALO = {
  productoShopifyId: '8965998510217',
  nombre: 'Gorra edición especial Ron Viejo de Caldas · Regalo',
  nombreCorto: 'Gorra Ron Viejo de Caldas',
  umbral: 199000, // COP, sin envío
  desde: '2026-11-01',
  hasta: '2026-12-31',
};

/** Fecha AAAA-MM-DD en Colombia (UTC-5). */
export function diaColombia(fecha = new Date()): string {
  return new Date(fecha.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
}

export function enBlackWeek(fecha = new Date()): boolean {
  const d = diaColombia(fecha);
  return d >= BLACK_WEEK.inicio && d <= BLACK_WEEK.fin;
}

/** La gorra va de regalo con este subtotal (sin envío) en esta fecha. */
export function regaloAplica(subtotal: number, fecha = new Date()): boolean {
  const d = diaColombia(fecha);
  return subtotal >= REGALO.umbral && d >= REGALO.desde && d <= REGALO.hasta;
}

/** Primer color de la gorra con unidades (o null si se agotaron todas). */
export async function varianteRegaloDisponible(): Promise<{ id: number; title: string } | null> {
  const producto = await obtenerProductoShopify(REGALO.productoShopifyId);
  const v = (producto?.variants || []).find((x) => x.inventory_policy === 'continue' || !x.inventory_management || (x.inventory_quantity || 0) > 0);
  return v ? { id: v.id, title: v.title } : null;
}

/** Lo que Sofi debe saber de la temporada (va en su instrucción). */
export function textoTemporadaSofi(fecha = new Date()): string {
  const bw = enBlackWeek(fecha)
    ? 'ESTAMOS EN BLACK WEEK: los precios del catálogo que ves ya son los de oferta; dilo con entusiasmo.'
    : 'Todavía no empieza: si preguntan, di que viene del 23 al 30 de noviembre y que los precios de oferta se verán en la tienda esos días. No prometas porcentajes ni productos concretos.';
  return `TEMPORADA (lo que anuncia la tienda; no inventes más):
- Black Week: del 23 al 30 de noviembre de 2026 hay precios de oferta ("precios rojos") en Ron Viejo de Caldas y Aguardiente Amarillo en tiendacommerkant.com.co. ${bw}
- Gorra de regalo: por compras desde $199.000 (sin contar el envío), del 1 de noviembre al 31 de diciembre de 2026, va de regalo una gorra Ron Viejo de Caldas (azul, beige o negra según disponibilidad), una por pedido y hasta agotar existencias. Aplica en la tienda online y en las compras por este chat; se agrega sola al pedido. No se vende por separado.`;
}
