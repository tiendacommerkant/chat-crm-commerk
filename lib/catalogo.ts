// ============================================
// CATÁLOGO — copia local de los productos de Shopify que usa el bot
// ============================================

import { supabaseAdmin } from './supabase';
import { obtenerProductosActivosShopify, mapearProductoParaBot } from './shopify';

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

  const mapeados = productos.map(mapearProductoParaBot);
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
