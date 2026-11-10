import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { unificarVentas, resumenVentas } from '@/lib/ventas-unificadas';

export const dynamic = 'force-dynamic';

// Pedidos de Shopify + compras por el bot, sin duplicar: una compra por el bot
// que ya es pedido en Shopify sale una sola vez (ver lib/ventas-unificadas.ts).
export async function GET() {
  try {
    const [{ data: pedidos }, { data: ventasBot }] = await Promise.all([
      supabaseAdmin.from('pedidos_shopify').select('*').order('shopify_created_at', { ascending: false }),
      supabaseAdmin.from('ventas').select('*, cliente:clientes(nombre, telefono)').order('created_at', { ascending: false }),
    ]);
    const todas = unificarVentas(pedidos || [], ventasBot || []);
    return NextResponse.json({ success: true, ventas: todas, stats: resumenVentas(todas) });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
