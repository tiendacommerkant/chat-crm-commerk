// ============================================
// TEMPORADA NOV-DIC 2026 — Black Week y gorra de regalo
// ============================================
// Lo mismo que anuncia la tienda online (barra superior, contador y página de
// la gorra). Sofi lo cuenta igual y los pedidos del bot también llevan la gorra.

import { obtenerProductoShopify } from './shopify';

export const BLACK_WEEK = { inicio: '2026-11-23', fin: '2026-11-30' };

/**
 * Máximo de unidades que un cliente puede comprar por día durante Black Week
 * (pedido del equipo, 19 nov), sumando la tienda online y el chat. El regalo
 * no cuenta. Lo usan Sofi, el carrito del bot, la alerta de pedidos y el
 * carrito de la tienda (tema Black Friday). Ver lib/limite-diario.ts
 */
export const LIMITE_DIARIO = { unidades: 6, desde: BLACK_WEEK.inicio, hasta: BLACK_WEEK.fin };

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

/** Lo que Sofi debe saber de la temporada (va en su instrucción). LIMITE_DIARIO está arriba. */
export function textoTemporadaSofi(fecha = new Date()): string {
  const limite = `máximo ${LIMITE_DIARIO.unidades} unidades por cliente al día (sumando la tienda online y este chat; el regalo no cuenta)`;
  const bw = enBlackWeek(fecha)
    ? `ESTAMOS EN BLACK WEEK (hasta el 30 de noviembre a las 11:59 p. m.). En el CATÁLOGO, los productos marcados "🔥 BLACK" tienen precio de oferta y traen su precio de antes: dilo con entusiasmo ("antes $X, hoy $Y"); en los kits el precio de cada botella ya es el de oferta. Los que no tienen la marca van a precio normal: no digas que están en oferta. No inventes porcentajes ni ofertas que no estén en el catálogo. Hasta agotar existencias. Límite: ${limite}; si pide más, explícale el límite con amabilidad (si es para surtir un negocio, accion "mayorista").`
    : `Todavía no empieza: si preguntan, di que viene del 23 al 30 de noviembre con precios rojos en Ron Viejo de Caldas y Aguardiente Amarillo, que los precios de oferta se verán esos días en la tienda y en este chat, y que durante Black Week habrá un ${limite}. No prometas porcentajes ni productos concretos.`;
  return `TEMPORADA (lo que anuncia la tienda; no inventes más):
- Black Week: del 23 al 30 de noviembre de 2026 hay precios de oferta ("precios rojos") en Ron Viejo de Caldas y Aguardiente Amarillo en tiendacommerkant.com.co. ${bw}
- Gorra de regalo: por compras desde $199.000 (sin contar el envío), del 1 de noviembre al 31 de diciembre de 2026, va de regalo una gorra Ron Viejo de Caldas (azul, beige o negra según disponibilidad), una por pedido y hasta agotar existencias. Aplica en la tienda online y en las compras por este chat; se agrega sola al pedido. No se vende por separado.`;
}
