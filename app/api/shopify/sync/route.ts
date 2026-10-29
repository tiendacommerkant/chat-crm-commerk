import { NextResponse } from 'next/server';
import { obtenerProductosActivosShopify, mapearProductoParaBot } from '@/lib/shopify';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// GET /api/shopify/sync → Sincroniza todos los productos de Shopify a Supabase
// y desactiva los que ya no están activos allá (borrador, archivado, oculto o
// borrado), para que el bot no los siga ofreciendo.
export async function GET() {
  try {
    const productos = await obtenerProductosActivosShopify();

    if (!productos || productos.length === 0) {
      return NextResponse.json({ success: false, message: 'No se encontraron productos en Shopify' }, { status: 404 });
    }

    const mapeados = productos.map(mapearProductoParaBot);

    const { data, error } = await supabaseAdmin
      .from('productos')
      .upsert(mapeados, { onConflict: 'shopify_id' })
      .select('id, shopify_id, titulo');

    if (error) throw error;

    const activosEnShopify = new Set(mapeados.map((p) => String(p.shopify_id)));
    const { data: activosEnCache, error: errCache } = await supabaseAdmin
      .from('productos')
      .select('id, shopify_id, titulo')
      .eq('activo', true);
    if (errCache) throw errCache;

    const sobrantes = (activosEnCache || []).filter((p) => !activosEnShopify.has(String(p.shopify_id)));
    if (sobrantes.length) {
      const { error: errDesactivar } = await supabaseAdmin
        .from('productos')
        .update({ activo: false, updated_at: new Date().toISOString() })
        .in('id', sobrantes.map((p) => p.id));
      if (errDesactivar) throw errDesactivar;
    }

    return NextResponse.json({
      success: true,
      sincronizados: data?.length || 0,
      total: productos.length,
      desactivados: sobrantes.map((p) => p.titulo),
      productos: data,
    });
  } catch (error: any) {
    console.error('Error sincronizando Shopify:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Error interno' },
      { status: 500 }
    );
  }
}
