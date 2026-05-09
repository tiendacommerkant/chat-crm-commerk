import { NextResponse } from 'next/server';
import { obtenerProductosShopify } from '@/lib/shopify';

export const dynamic = 'force-dynamic';

// GET /api/shopify/products → Lista productos directamente desde Shopify (sin cache)
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limite = parseInt(url.searchParams.get('limit') || '50');

    const productos = await obtenerProductosShopify(limite);

    const resumen = productos.map((p) => {
      const variant = p.variants?.[0];
      return {
        id: p.id,
        titulo: p.title,
        precio: variant?.price ? parseFloat(variant.price) : 0,
        inventario: variant?.inventory_quantity ?? 0,
        imagen: p.image?.src || null,
        tipo: p.product_type,
        estado: p.status,
        tags: p.tags,
      };
    });

    return NextResponse.json({ success: true, total: resumen.length, productos: resumen });
  } catch (error: any) {
    console.error('Error obteniendo productos:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
