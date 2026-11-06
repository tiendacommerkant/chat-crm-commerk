// ============================================
// CATÁLOGO — copia local de los productos de Shopify que usa el bot
// ============================================

import { supabaseAdmin } from './supabase';
import { obtenerProductosActivosShopify, mapearProductoParaBot } from './shopify';
import { preciosColombia, conPreciosDeMercado } from './precios-mercado';
import { registrarEvento } from './eventos';

export interface ResultadoSincronizacion {
  sincronizados: number;
  total: number;
  desactivados: string[];
  productos: Array<{ id: string; shopify_id: string; titulo: string }>;
}

/**
 * Copia los productos activos de Shopify y desactiva los que ya no están
 * activos allá (borrador, archivado, oculto o borrado), para que el bot no
 * los siga ofreciendo. Lanza error si Shopify falla: con una lista
 * incompleta se apagarían productos que sí se venden.
 */
export async function sincronizarCatalogo(): Promise<ResultadoSincronizacion> {
  const productos = await obtenerProductosActivosShopify();
  if (!productos.length) throw new Error('Shopify no devolvió productos activos');

  // Precio de Colombia (incluye el catálogo de Black Friday cuando está activo).
  // Si falla, se sincroniza con el precio base y la tarea de cada 10 minutos lo corrige.
  const precios = await preciosColombia().catch(async (e) => {
    await registrarEvento('aviso', 'catalogo', `No se pudieron leer los precios de Colombia; se usa el precio base: ${e.message}`);
    return null;
  });
  const mapeados = productos.map((p) => mapearProductoParaBot(conPreciosDeMercado(p, precios)));
  const { data, error } = await supabaseAdmin
    .from('productos')
    .upsert(mapeados, { onConflict: 'shopify_id' })
    .select('id, shopify_id, titulo');
  if (error) throw error;

  const activosEnShopify = new Set(mapeados.map((p) => String(p.shopify_id)));
  const { data: activosEnCache, error: errCache } = await supabaseAdmin
    .from('productos').select('id, shopify_id, titulo').eq('activo', true);
  if (errCache) throw errCache;

  const sobrantes = (activosEnCache || []).filter((p) => !activosEnShopify.has(String(p.shopify_id)));
  if (sobrantes.length) {
    const { error: errDesactivar } = await supabaseAdmin
      .from('productos')
      .update({ activo: false, updated_at: new Date().toISOString() })
      .in('id', sobrantes.map((p) => p.id));
    if (errDesactivar) throw errDesactivar;
  }

  return {
    sincronizados: data?.length || 0,
    total: productos.length,
    desactivados: sobrantes.map((p) => p.titulo),
    productos: data || [],
  };
}
