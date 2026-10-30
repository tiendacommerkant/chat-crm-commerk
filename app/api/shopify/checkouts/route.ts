// GET /api/shopify/checkouts → Sincroniza carritos abandonados desde Shopify al CRM
// (botón "Sync Carritos Shopify"). Usa el mismo guardado que la sincronización
// automática: valida el celular, conserva los estados notificado/convertido y
// no reescribe los carritos que no cambiaron.
import { NextResponse } from 'next/server';
import { obtenerCheckoutsAbandonadosShopify } from '@/lib/shopify';
import { guardarCheckout } from '@/lib/carritos';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limite = Math.min(parseInt(searchParams.get('limit') || '250') || 250, 250);

    const checkouts = await obtenerCheckoutsAbandonadosShopify(limite);
    if (!checkouts.length) {
      return NextResponse.json({ success: true, sincronizados: 0, errores: 0, total: 0, message: 'Sin checkouts en Shopify' });
    }

    let sincronizados = 0;
    let errores = 0;
    for (const checkout of checkouts) {
      if (await guardarCheckout(checkout)) sincronizados++;
      else errores++;
    }
    return NextResponse.json({ success: true, sincronizados, errores, total: checkouts.length });
  } catch (error: any) {
    console.error('Error sincronizando checkouts:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
