import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Pedidos Shopify (fuente principal)
    const { data: pedidos } = await supabaseAdmin
      .from('pedidos_shopify')
      .select('*')
      .order('shopify_created_at', { ascending: false });

    // Ventas del bot/Wompi (fuente secundaria)
    const { data: ventasBot } = await supabaseAdmin
      .from('ventas')
      .select('*, cliente:clientes(nombre, telefono)')
      .order('created_at', { ascending: false });

    // Normalizar pedidos Shopify al formato unificado
    const pedidosNorm = (pedidos || []).map((p) => ({
      id: p.id,
      fuente: 'shopify' as const,
      fecha: p.shopify_created_at || p.created_at,
      referencia: `#${p.shopify_order_number}`,
      nombre_cliente: p.nombre_cliente || 'Sin nombre',
      telefono: p.telefono || null,
      email: p.email || null,
      productos: (p.items || []).map((i: any) => `${i.title} ×${i.quantity}`).join(', '),
      cantidad: (p.items || []).reduce((s: number, i: any) => s + (i.quantity || 1), 0),
      total: p.total || 0,
      descuentos: p.total_descuentos || 0,
      estado: mapearEstadoShopify(p.estado_financiero),
      estado_financiero: p.estado_financiero,
      estado_fulfillment: p.estado_fulfillment,
      notificado_whatsapp: p.notificado_whatsapp,
    }));

    // Normalizar ventas bot al formato unificado
    const ventasNorm = (ventasBot || []).map((v) => ({
      id: v.id,
      fuente: 'bot' as const,
      fecha: v.created_at,
      referencia: v.referencia_pago || '—',
      nombre_cliente: v.cliente?.nombre || 'Sin nombre',
      telefono: v.cliente?.telefono || null,
      email: null,
      productos: v.producto_nombre || '—',
      cantidad: v.cantidad || 1,
      total: v.total || 0,
      descuentos: 0,
      estado: v.estado,
      estado_financiero: v.estado,
      estado_fulfillment: null,
      notificado_whatsapp: false,
    }));

    // Unificar y ordenar por fecha
    const todas = [...pedidosNorm, ...ventasNorm].sort(
      (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()
    );

    const totalRevenue = todas
      .filter((v) => v.estado === 'pagado')
      .reduce((s, v) => s + v.total, 0);

    return NextResponse.json({
      success: true,
      ventas: todas,
      stats: {
        total: todas.length,
        pagadas: todas.filter((v) => v.estado === 'pagado').length,
        pendientes: todas.filter((v) => v.estado === 'pendiente').length,
        canceladas: todas.filter((v) => v.estado === 'cancelado').length,
        revenue: totalRevenue,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

function mapearEstadoShopify(estado: string): string {
  const map: Record<string, string> = {
    paid: 'pagado',
    pending: 'pendiente',
    partially_paid: 'pendiente',
    refunded: 'reembolsado',
    voided: 'cancelado',
    authorized: 'pendiente',
  };
  return map[estado] || estado;
}
