// GET /api/shopify/checkouts → Sincroniza carritos abandonados desde Shopify al CRM
import { NextResponse } from 'next/server';
import { obtenerCheckoutsAbandonadosShopify, extraerTelefonoCheckout } from '@/lib/shopify';
import { formatearNumeroWhatsApp } from '@/lib/whatsapp';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limite = parseInt(searchParams.get('limit') || '250');

    const checkouts = await obtenerCheckoutsAbandonadosShopify(limite);

    if (!checkouts.length) {
      return NextResponse.json({ success: true, sincronizados: 0, message: 'Sin checkouts en Shopify' });
    }

    let sincronizados = 0;
    let errores = 0;
    const corteAbandonado = new Date(Date.now() - 45 * 60 * 1000);

    for (const checkout of checkouts) {
      try {
        const telefono = extraerTelefonoCheckout(checkout);
        const telefonoFormateado = telefono ? formatearNumeroWhatsApp(telefono) : null;

        const nombre = [
          checkout.shipping_address?.first_name || checkout.customer?.first_name,
          checkout.shipping_address?.last_name  || checkout.customer?.last_name,
        ].filter(Boolean).join(' ') || checkout.email || 'Anónimo';

        const items = (checkout.line_items || []).map((i: any) => ({
          title: i.title || i.variant_title || 'Producto',
          quantity: i.quantity || 1,
          price: parseFloat(i.price || '0'),
        }));

        const total = parseFloat(checkout.total_price || '0');
        const updatedAt = new Date(checkout.updated_at || checkout.created_at);
        const estado = updatedAt < corteAbandonado ? 'abandonado' : 'en_progreso';

        await supabaseAdmin.from('carritos_abandonados').upsert({
          shopify_checkout_id: checkout.id?.toString() || checkout.token,
          shopify_token: checkout.token,
          email: checkout.email || null,
          telefono: telefonoFormateado,
          nombre,
          total,
          items,
          url_checkout: checkout.abandoned_checkout_url || null,
          estado,
          shopify_created_at: checkout.created_at,
          shopify_updated_at: checkout.updated_at,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'shopify_checkout_id' });

        sincronizados++;
      } catch {
        errores++;
      }
    }

    // Marcar como 'abandonado' los que llevan más de 45 min en en_progreso
    const corte = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    await supabaseAdmin
      .from('carritos_abandonados')
      .update({ estado: 'abandonado', updated_at: new Date().toISOString() })
      .eq('estado', 'en_progreso')
      .lt('shopify_updated_at', corte);

    return NextResponse.json({ success: true, sincronizados, errores, total: checkouts.length });
  } catch (error: any) {
    console.error('Error sincronizando checkouts:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
