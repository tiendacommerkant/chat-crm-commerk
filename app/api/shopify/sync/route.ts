import { NextResponse } from 'next/server';
import { obtenerProductosShopify, mapearProductoParaBot } from '@/lib/shopify';
import { supabaseAdmin } from '@/lib/supabase';

// GET /api/shopify/sync → Sincroniza todos los productos de Shopify a Supabase
export async function GET() {
  try {
    const productos = await obtenerProductosShopify(250);

    if (!productos || productos.length === 0) {
      return NextResponse.json({ success: false, message: 'No se encontraron productos en Shopify' }, { status: 404 });
    }

    const mapeados = productos.map(mapearProductoParaBot);

    const { data, error } = await supabaseAdmin
      .from('productos')
      .upsert(mapeados, { onConflict: 'shopify_id' })
      .select('id, shopify_id, titulo');

    if (error) throw error;

    return NextResponse.json({
      success: true,
      sincronizados: data?.length || 0,
      total: productos.length,
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
