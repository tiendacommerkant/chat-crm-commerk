// ============================================
// PRECIOS PARA COLOMBIA — los mismos que ve el comprador en la tienda
// ============================================
// Los catálogos de Mercados (por ejemplo "Viernes Negro 2026", que enciende
// el lanzamiento de Black Week) no cambian el precio base de la variante: la
// API REST de productos sigue devolviendo el normal y el bot cotizaba ese.
// Shopify da el precio que aplica en un país con contextualPricing; con él el
// bot cobra lo mismo que la tienda, y vuelve solo al precio normal cuando el
// catálogo se apaga.

import type { ShopifyProduct } from '@/types';
import { supabaseAdmin } from './supabase';
import type { Variante } from './variantes';

const PAIS = 'CO';

/** Precio por variante de cada producto: producto → (variante → precio). */
export type PreciosMercado = Map<string, Map<string, number>>;

async function consultar(query: string, variables: Record<string, any>) {
  const r = await fetch(`https://${process.env.SHOPIFY_STORE}.myshopify.com/admin/api/2025-10/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
  });
  const j = await r.json();
  if (!r.ok || j.errors) throw new Error(`Shopify (precios ${PAIS}): ${r.status} ${JSON.stringify(j.errors || '').slice(0, 200)}`);
  return j.data;
}

function agregar(precios: PreciosMercado, productoId: string, varianteId: string, monto: string | number | undefined) {
  const precio = Number(monto);
  if (!(precio > 0)) return;
  if (!precios.has(productoId)) precios.set(productoId, new Map());
  precios.get(productoId)!.set(varianteId, precio);
}

/** Precios en Colombia de todas las variantes activas (o solo de los productos indicados). */
export async function preciosColombia(productoIds?: string[]): Promise<PreciosMercado> {
  const precios: PreciosMercado = new Map();
  if (productoIds?.length) {
    const data = await consultar(
      `query($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { legacyResourceId variants(first: 100) { nodes { legacyResourceId contextualPricing(context: {country: ${PAIS}}) { price { amount } } } } } } }`,
      { ids: productoIds.map((id) => `gid://shopify/Product/${id}`) }
    );
    for (const p of data.nodes || []) {
      for (const v of p?.variants?.nodes || []) agregar(precios, String(p.legacyResourceId), String(v.legacyResourceId), v.contextualPricing?.price?.amount);
    }
    return precios;
  }
  let cursor: string | null = null;
  do {
    const data = await consultar(
      `query($c: String) { productVariants(first: 250, after: $c, query: "product_status:active") { nodes { legacyResourceId product { legacyResourceId } contextualPricing(context: {country: ${PAIS}}) { price { amount } } } pageInfo { hasNextPage endCursor } } }`,
      { c: cursor }
    );
    for (const v of data.productVariants.nodes) agregar(precios, String(v.product.legacyResourceId), String(v.legacyResourceId), v.contextualPricing?.price?.amount);
    cursor = data.productVariants.pageInfo.hasNextPage ? data.productVariants.pageInfo.endCursor : null;
  } while (cursor);
  return precios;
}

/** El producto de Shopify con el precio de Colombia en cada variante (para mapearProductoParaBot). */
export function conPreciosDeMercado(producto: ShopifyProduct, precios: PreciosMercado | null): ShopifyProduct {
  const delProducto = precios?.get(String(producto.id));
  if (!delProducto) return producto;
  return {
    ...producto,
    variants: (producto.variants || []).map((v) => {
      const precio = delProducto.get(String(v.id));
      return precio ? { ...v, price: precio.toFixed(2) } : v;
    }),
  };
}

interface FilaProducto { id: string; shopify_id: string; precio: number | string; metadata?: Record<string, any> | null }

/**
 * Precio y variantes que deberían quedar en la copia local, o null si no
 * cambió nada. Un producto de una sola variante toma el precio de esa variante;
 * los kits, el de cada botella y el "desde" (el menor).
 */
export function preciosActualizados(fila: FilaProducto, delProducto: Map<string, number> | undefined) {
  if (!delProducto?.size) return null;
  const variantes: Variante[] | undefined = fila.metadata?.variantes;
  if (variantes?.length) {
    const nuevas = variantes.map((v) => ({ ...v, precio: delProducto.get(String(v.id)) ?? v.precio }));
    const cambio = nuevas.some((v, i) => Math.abs(v.precio - variantes[i].precio) >= 1);
    if (!cambio) return null;
    return { precio: Math.min(...nuevas.map((v) => v.precio)), metadata: { ...fila.metadata, variantes: nuevas } };
  }
  if (delProducto.size !== 1) return null;
  const precio = [...delProducto.values()][0];
  return Math.abs(precio - Number(fila.precio)) >= 1 ? { precio } : null;
}

/**
 * Pone en la copia local del bot el precio vigente en Colombia. La llama la
 * tarea de cada 10 minutos: así el bot cambia de precio a los pocos minutos de
 * que el lanzamiento encienda o apague el catálogo de Black Friday.
 */
export async function actualizarPreciosMercado(): Promise<{ revisados: number; actualizados: string[] }> {
  const precios = await preciosColombia();
  if (!precios.size) throw new Error('Shopify no devolvió precios');
  const { data, error } = await supabaseAdmin.from('productos').select('id, shopify_id, titulo, precio, metadata').eq('activo', true);
  if (error) throw error;

  const actualizados: string[] = [];
  for (const fila of (data as Array<FilaProducto & { titulo: string }>) || []) {
    const cambios = preciosActualizados(fila, precios.get(String(fila.shopify_id)));
    if (!cambios) continue;
    const { error: e } = await supabaseAdmin.from('productos')
      .update({ ...cambios, updated_at: new Date().toISOString() }).eq('id', fila.id);
    if (!e) actualizados.push(fila.titulo);
  }
  return { revisados: data?.length || 0, actualizados };
}
