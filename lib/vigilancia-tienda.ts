// ============================================
// VIGILANCIA DE LA TIENDA — pagos, pedidos y carritos al día
// ============================================
// Corre con la tarea de cada 10 minutos (/api/cron/recuperar-carritos):
//
// 1. Pagos sin pedido: un pago de la tienda web aprobado en Wompi que a los
//    20 minutos no tiene pedido en Shopify queda como error en "Estado del
//    sistema". Antes el equipo se enteraba cuando el cliente reclamaba
//    (Kevin Giraldo, 10 nov 2026). Shopify guarda la referencia de Wompi
//    como payment_id de la transacción del pedido: así se cruzan exacto.
// 2. Estados de pedidos: si se perdió un aviso de Shopify (despachado,
//    cancelado…), el CRM lo toma de Shopify. #2687, #2689 y #2690 se
//    despacharon y en el CRM seguían "sin despachar".
// 3. Carritos comprados: el carrito de quien compró (mismo correo o celular)
//    pasa a "Compró" aunque el aviso del pedido haya llegado antes que el
//    del carrito.
//
// La lógica que decide está en funciones puras (probadas en tests/); las que
// consultan Wompi, Shopify y la base solo traen y guardan.

import { supabaseAdmin } from './supabase';
import { registrarEvento } from './eventos';
import { formatearPrecioCOP } from './shopify';

const MIN = 60_000;
const HORA = 60 * MIN;

// ── Funciones puras ─────────────────────────────────────────────────────────

export interface TransaccionWompiResumen {
  id?: string;
  reference: string;
  status: string;
  amount_in_cents: number;
  created_at: string;
  finalized_at?: string | null;
  payment_link_id?: string | null;
  payment_method_type?: string;
  customer_email?: string | null;
  customer_data?: { full_name?: string | null; phone_number?: string | null } | null;
}

/** Pago hecho en el checkout de la tienda web (no un link del bot ni un link de cobro manual). */
export function esPagoDeLaTienda(t: Pick<TransaccionWompiResumen, 'reference' | 'payment_link_id'>): boolean {
  return !String(t.reference || '').startsWith('WA-') && !t.payment_link_id;
}

/**
 * Pagos aprobados de la tienda web que no tienen pedido en Shopify: más de
 * `esperaMin` minutos desde el pago (la app de Wompi tarda unos segundos en
 * crearlo) y dentro de las últimas `ventanaHoras` horas.
 */
export function pagosSinPedido(
  transacciones: TransaccionWompiResumen[],
  pagosConPedido: Set<string>,
  ahora: Date,
  { esperaMin = 20, ventanaHoras = 48 }: { esperaMin?: number; ventanaHoras?: number } = {}
): TransaccionWompiResumen[] {
  return transacciones.filter((t) => {
    if (t.status !== 'APPROVED' || !esPagoDeLaTienda(t)) return false;
    const cuando = new Date(t.finalized_at || t.created_at).getTime();
    const edad = ahora.getTime() - cuando;
    return edad >= esperaMin * MIN && edad <= ventanaHoras * HORA && !pagosConPedido.has(t.reference);
  });
}

export interface PedidoShopifyEstado {
  id: number | string;
  financial_status: string | null;
  fulfillment_status: string | null;
  cancelled_at?: string | null;
}

/** Qué filas de pedidos_shopify quedaron atrás de Shopify (estado de pago o de despacho). */
export function cambiosDePedidos(
  shopify: PedidoShopifyEstado[],
  crm: Array<{ shopify_order_id: number | string; estado_financiero: string | null; estado_fulfillment: string | null }>
): Array<{ shopify_order_id: string; estado_financiero: string | null; estado_fulfillment: string | null }> {
  const porId = new Map(crm.map((c) => [String(c.shopify_order_id), c]));
  const cambios: Array<{ shopify_order_id: string; estado_financiero: string | null; estado_fulfillment: string | null }> = [];
  for (const o of shopify) {
    const fila = porId.get(String(o.id));
    if (!fila) continue; // los pedidos nuevos los guarda el aviso orders/paid
    const financiero = o.cancelled_at ? 'cancelled' : o.financial_status;
    const despacho = o.fulfillment_status || null;
    if (financiero !== fila.estado_financiero || despacho !== (fila.estado_fulfillment || null)) {
      cambios.push({ shopify_order_id: String(o.id), estado_financiero: financiero, estado_fulfillment: despacho });
    }
  }
  return cambios;
}

const ESTADOS_COMPRA = ['paid', 'partially_paid', 'partially_refunded', 'pending', 'authorized'];
const ultimos10 = (t?: string | null) => String(t || '').replace(/\D/g, '').slice(-10);

/**
 * Carritos de clientes que sí compraron (mismo correo o celular) desde 2 horas
 * antes del carrito: Shopify a veces registra el checkout unos minutos después
 * del pedido, y así el carrito quedaba "abandonado" y hasta se le recordaba.
 */
export function carritosYaComprados(
  carritos: Array<{ id: string; email?: string | null; telefono?: string | null; estado: string; shopify_created_at?: string | null }>,
  pedidos: Array<{ email?: string | null; telefono?: string | null; estado_financiero?: string | null; shopify_created_at?: string | null }>
): string[] {
  const compras = pedidos.filter((p) => ESTADOS_COMPRA.includes(String(p.estado_financiero)) && p.shopify_created_at);
  return carritos
    .filter((c) => c.estado !== 'convertido' && c.shopify_created_at)
    .filter((c) => {
      const desde = new Date(c.shopify_created_at!).getTime() - 2 * HORA;
      const correo = String(c.email || '').trim().toLowerCase();
      const cel = ultimos10(c.telefono);
      return compras.some((p) => new Date(p.shopify_created_at!).getTime() >= desde &&
        ((correo && String(p.email || '').trim().toLowerCase() === correo) || (cel.length === 10 && ultimos10(p.telefono) === cel)));
    })
    .map((c) => c.id);
}

// ── Consultas a Wompi, Shopify y la base ────────────────────────────────────

const dia = (d: Date) => d.toISOString().slice(0, 10);

function shopifyBase(): { url: string; headers: Record<string, string> } {
  const tienda = String(process.env.SHOPIFY_STORE || '');
  const dominio = tienda.includes('.') ? tienda : `${tienda}.myshopify.com`;
  return { url: `https://${dominio}/admin/api/2024-10`, headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN || '' } };
}

async function transaccionesWompi(desde: Date, hasta: Date): Promise<TransaccionWompiResumen[]> {
  const llave = process.env.WOMPI_PRIVATE_KEY || '';
  const base = llave.startsWith('prv_test') ? 'https://sandbox.wompi.co' : 'https://production.wompi.co';
  const todas: TransaccionWompiResumen[] = [];
  for (let pagina = 1; pagina <= 6; pagina++) {
    const r = await fetch(`${base}/v1/transactions?from_date=${dia(desde)}&until_date=${dia(hasta)}&page=${pagina}&page_size=50`, {
      headers: { Authorization: `Bearer ${llave}` }, signal: AbortSignal.timeout(15_000), cache: 'no-store',
    });
    if (!r.ok) throw new Error(`Wompi respondió HTTP ${r.status}`);
    const lote = ((await r.json())?.data || []) as TransaccionWompiResumen[];
    todas.push(...lote);
    if (lote.length < 50) break;
  }
  return todas;
}

/** Referencias de Wompi (payment_id) de los pedidos de Shopify creados desde `desde`. */
async function pagosConPedidoEnShopify(desde: Date): Promise<Set<string>> {
  const { url, headers } = shopifyBase();
  const r = await fetch(`${url}/orders.json?status=any&created_at_min=${desde.toISOString()}&limit=250&fields=id,payment_gateway_names`, {
    headers, signal: AbortSignal.timeout(15_000), cache: 'no-store',
  });
  if (!r.ok) throw new Error(`Shopify respondió HTTP ${r.status} al listar pedidos`);
  const pedidos = ((await r.json())?.orders || []) as Array<{ id: number; payment_gateway_names?: string[] }>;
  const conWompi = pedidos.filter((o) => (o.payment_gateway_names || []).some((g) => /wompi/i.test(g)));
  const ids = new Set<string>();
  await Promise.all(conWompi.map(async (o) => {
    const t = await fetch(`${url}/orders/${o.id}/transactions.json`, { headers, signal: AbortSignal.timeout(15_000), cache: 'no-store' });
    if (!t.ok) throw new Error(`Shopify respondió HTTP ${t.status} al leer el pago del pedido ${o.id}`);
    for (const tx of ((await t.json())?.transactions || []) as any[]) {
      if (tx.payment_id) ids.add(String(tx.payment_id));
      if (tx.authorization) ids.add(String(tx.authorization));
    }
  }));
  return ids;
}

export async function vigilarPagosTienda(ahora = new Date()): Promise<{ aprobados: number; sin_pedido: number; alertados: number }> {
  const transacciones = await transaccionesWompi(new Date(ahora.getTime() - 48 * HORA), new Date(ahora.getTime() + 24 * HORA));
  const aprobados = transacciones.filter((t) => t.status === 'APPROVED' && esPagoDeLaTienda(t)).length;
  // Sin candidatos no hace falta preguntarle a Shopify
  const candidatos = pagosSinPedido(transacciones, new Set(), ahora);
  if (!candidatos.length) return { aprobados, sin_pedido: 0, alertados: 0 };

  const masViejo = Math.min(...candidatos.map((t) => new Date(t.created_at).getTime()));
  const conPedido = await pagosConPedidoEnShopify(new Date(masViejo - 24 * HORA));
  const huerfanos = pagosSinPedido(transacciones, conPedido, ahora);

  let alertados = 0;
  for (const t of huerfanos) {
    // Una sola alerta por pago
    const { data: previa } = await supabaseAdmin.from('eventos_sistema').select('id')
      .eq('origen', 'wompi').eq('detalle->>alerta', 'pago_sin_pedido').eq('detalle->>referencia', t.reference).limit(1);
    if (previa?.length) continue;
    const nombre = t.customer_data?.full_name || 'Cliente sin nombre';
    const telefono = t.customer_data?.phone_number || null;
    const cuando = new Date(t.finalized_at || t.created_at).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    await registrarEvento('error', 'wompi',
      `Pago aprobado en la tienda web SIN pedido en Shopify: ${nombre}${telefono ? ` · ${telefono}` : ''} · ${formatearPrecioCOP(t.amount_in_cents / 100)} · ${cuando} (ref ${t.reference}). La app de Wompi no creó el pedido: créalo a mano en Shopify.`,
      { alerta: 'pago_sin_pedido', referencia: t.reference, transaccion: t.id || null, monto: t.amount_in_cents / 100, cliente: nombre, telefono, email: t.customer_email || null, metodo: t.payment_method_type || null, pagado: t.finalized_at || t.created_at });
    alertados++;
  }
  return { aprobados, sin_pedido: huerfanos.length, alertados };
}

/** Pone al día en el CRM el estado de pago y de despacho de los pedidos que cambiaron en Shopify. */
export async function sincronizarEstadosPedidos(dias = 15): Promise<{ revisados: number; actualizados: number }> {
  const { url, headers } = shopifyBase();
  const desde = new Date(Date.now() - dias * 24 * HORA).toISOString();
  const r = await fetch(`${url}/orders.json?status=any&updated_at_min=${desde}&limit=250&fields=id,name,financial_status,fulfillment_status,cancelled_at`, {
    headers, signal: AbortSignal.timeout(15_000), cache: 'no-store',
  });
  if (!r.ok) throw new Error(`Shopify respondió HTTP ${r.status} al listar pedidos`);
  const pedidos = ((await r.json())?.orders || []) as PedidoShopifyEstado[];
  if (!pedidos.length) return { revisados: 0, actualizados: 0 };

  const { data: filas, error } = await supabaseAdmin.from('pedidos_shopify')
    .select('shopify_order_id, estado_financiero, estado_fulfillment')
    .in('shopify_order_id', pedidos.map((o) => o.id));
  if (error) throw new Error(error.message);

  const cambios = cambiosDePedidos(pedidos, (filas || []) as any[]);
  for (const c of cambios) {
    await supabaseAdmin.from('pedidos_shopify')
      .update({ estado_financiero: c.estado_financiero, estado_fulfillment: c.estado_fulfillment, updated_at: new Date().toISOString() })
      .eq('shopify_order_id', c.shopify_order_id);
  }
  return { revisados: pedidos.length, actualizados: cambios.length };
}

/** Marca "Compró" los carritos de los últimos días cuyo cliente ya tiene un pedido. */
export async function marcarCarritosComprados(dias = 15): Promise<{ marcados: number }> {
  const desde = new Date(Date.now() - dias * 24 * HORA).toISOString();
  const [{ data: carritos }, { data: pedidos }] = await Promise.all([
    supabaseAdmin.from('carritos_abandonados').select('id, email, telefono, estado, shopify_created_at')
      .gte('shopify_created_at', desde).in('estado', ['en_progreso', 'abandonado', 'notificado']).limit(1000),
    supabaseAdmin.from('pedidos_shopify').select('email, telefono, estado_financiero, shopify_created_at')
      .gte('shopify_created_at', new Date(Date.now() - (dias + 1) * 24 * HORA).toISOString()).limit(1000),
  ]);
  const ids = carritosYaComprados((carritos || []) as any[], (pedidos || []) as any[]);
  if (ids.length) {
    await supabaseAdmin.from('carritos_abandonados').update({ estado: 'convertido', updated_at: new Date().toISOString() }).in('id', ids);
  }
  return { marcados: ids.length };
}
