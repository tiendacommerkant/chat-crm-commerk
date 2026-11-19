// ============================================
// LÍMITE DE UNIDADES POR CLIENTE AL DÍA (Black Week)
// ============================================
// Con los precios de Black Friday el equipo limita la compra a 6 unidades por
// cliente al día (lib/temporada.ts LIMITE_DIARIO), sumando lo que compra por
// este chat y en la tienda online. El bot no deja pasar del límite; en la
// tienda el carrito del tema Black Friday tiene el mismo tope por pedido y,
// si alguien junta más con varios pedidos, el CRM avisa al equipo.
import { supabaseAdmin } from './supabase';
import { registrarEvento } from './eventos';
import { LIMITE_DIARIO, diaColombia } from './temporada';
import { esIdUsuarioWhatsApp } from './whatsapp-id';

export const LIMITE_UNIDADES = LIMITE_DIARIO.unidades;

/** El límite rige este día (hora de Colombia). */
export function limiteActivo(fecha = new Date()): boolean {
  const d = diaColombia(fecha);
  return d >= LIMITE_DIARIO.desde && d <= LIMITE_DIARIO.hasta;
}

/** Medianoche de hoy en Colombia (UTC-5), en ISO. */
export function inicioDiaColombia(fecha = new Date()): string {
  return new Date(`${diaColombia(fecha)}T05:00:00.000Z`).toISOString();
}

export interface ClienteLimite { id?: string | null; telefono?: string | null; email?: string | null }
interface PedidoDia {
  cliente_id?: string | null; telefono?: string | null; email?: string | null;
  items?: Array<{ quantity?: number; price?: number }> | null;
  direccion_envio?: { referencia_pago?: string | null } | null;
}

function celular10(t?: string | null): string {
  if (!t || esIdUsuarioWhatsApp(t)) return '';
  const d = t.replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

/**
 * Unidades que el cliente ya compró hoy: pedidos de Shopify (tienda y bot) y
 * ventas del bot pagadas cuyo pedido no quedó en Shopify. Lo que va en $0 (la
 * gorra de regalo, la caja) no cuenta.
 */
export function unidadesDelCliente(pedidos: PedidoDia[], ventasPagadas: Array<{ cantidad?: number; referencia_pago?: string | null }>, cliente: ClienteLimite): number {
  const tel = celular10(cliente.telefono);
  const email = (cliente.email || '').trim().toLowerCase();
  const suyos = pedidos.filter((p) =>
    (!!cliente.id && p.cliente_id === cliente.id) ||
    (!!tel && celular10(p.telefono) === tel) ||
    (!!email && (p.email || '').trim().toLowerCase() === email));
  const enPedidos = suyos.reduce((s, p) => s + (p.items || []).filter((i) => Number(i.price) > 0).reduce((a, i) => a + Number(i.quantity || 0), 0), 0);
  const refs = new Set(suyos.map((p) => p.direccion_envio?.referencia_pago).filter(Boolean));
  const sinPedido = ventasPagadas.filter((v) => !refs.has(v.referencia_pago)).reduce((s, v) => s + Number(v.cantidad || 0), 0);
  return enPedidos + sinPedido;
}

const ESTADOS_COMPRA = ['paid', 'partially_paid', 'partially_refunded', 'pending', 'authorized'];

/** Unidades que el cliente compró hoy (hora de Colombia) por el chat y en la tienda. */
export async function unidadesCompradasHoy(cliente: ClienteLimite, fecha = new Date()): Promise<number> {
  const desde = inicioDiaColombia(fecha);
  const [{ data: pedidos }, { data: ventas }] = await Promise.all([
    supabaseAdmin.from('pedidos_shopify').select('cliente_id, telefono, email, items, direccion_envio')
      .gte('shopify_created_at', desde).in('estado_financiero', ESTADOS_COMPRA).limit(3000),
    cliente.id
      ? supabaseAdmin.from('ventas').select('cantidad, referencia_pago').eq('cliente_id', cliente.id).eq('estado', 'pagado').gte('updated_at', desde).limit(200)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  return unidadesDelCliente((pedidos as PedidoDia[]) || [], (ventas as any[]) || [], cliente);
}

/** Unidades pagas de un carrito (el regalo en $0 no cuenta). */
export function unidadesCarrito(cart: Array<{ cantidad: number; precio: number }>): number {
  return cart.filter((i) => Number(i.precio) > 0).reduce((s, i) => s + Number(i.cantidad || 0), 0);
}

/** Lo que el cliente todavía puede comprar hoy (nunca negativo). */
export function unidadesDisponibles(compradasHoy: number): number {
  return Math.max(0, LIMITE_UNIDADES - compradasHoy);
}

/**
 * Después de un pago (bot o tienda): si el cliente ya pasó el límite del día,
 * queda un aviso en Estado del sistema para que el equipo decida (contactarlo
 * o cancelar) y el pedido se marca en Shopify con la etiqueta
 * excede-limite-diario.
 */
export async function revisarLimiteDespuesDePago(cliente: ClienteLimite & { nombre?: string | null }, pedido: string, ordenGid?: string | null): Promise<number | null> {
  if (!limiteActivo()) return null;
  const unidades = await unidadesCompradasHoy(cliente);
  if (unidades <= LIMITE_UNIDADES) return unidades;
  // Shopify manda el aviso del pedido dos veces: una sola alerta por pedido
  const { data: previa } = await supabaseAdmin.from('eventos_sistema').select('id')
    .eq('origen', 'limite').eq('detalle->>pedido', pedido).limit(1);
  if (previa?.length) return unidades;
  await registrarEvento('aviso', 'limite',
    `${cliente.nombre || 'Un cliente'} lleva ${unidades} unidades compradas hoy (el límite de Black Week es ${LIMITE_UNIDADES} por día). Último pedido ${pedido}: revisa si hay que contactarlo o cancelar.`,
    { pedido, telefono: cliente.telefono || null, email: cliente.email || null, unidades });
  if (ordenGid) await etiquetarPedido(ordenGid, 'excede-limite-diario').catch(() => {});
  return unidades;
}

async function etiquetarPedido(ordenGid: string, etiqueta: string) {
  const store = process.env.SHOPIFY_STORE || '';
  const host = store.includes('.') ? store : `${store}.myshopify.com`;
  await fetch(`https://${host}/admin/api/2025-10/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN || '', 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'mutation($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { message } } }', variables: { id: ordenGid, tags: [etiqueta] } }),
    signal: AbortSignal.timeout(8000),
  });
}

/** Mensaje del bot cuando el carrito pasa del límite. */
export function textoLimite(compradasHoy: number, enCarrito: number): string {
  const disponibles = unidadesDisponibles(compradasHoy);
  const regla = `En Black Week cada cliente puede comprar hasta *${LIMITE_UNIDADES} unidades al día* (sumando la tienda online y este chat)`;
  if (disponibles === 0) return `🛑 ${regla}, y hoy ya completaste las tuyas. Mañana puedes volver a comprar 🙌`;
  const llevas = compradasHoy > 0 ? `Hoy ya compraste ${compradasHoy}, así que puedes llevar hasta *${disponibles}* más` : `Tu carrito tiene ${enCarrito}, así que puedes llevar hasta *${disponibles}*`;
  return `🛑 ${regla}. ${llevas}. ¿Qué dejamos? Dime, por ejemplo, "solo 2 del amarillo".`;
}
