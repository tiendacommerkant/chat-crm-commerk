import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const estado = searchParams.get('estado') || 'todos';
    const busqueda = searchParams.get('q') || '';
    const pagina = parseInt(searchParams.get('pagina') || '1');
    const porPagina = parseInt(searchParams.get('por_pagina') || '50');

    let query = supabaseAdmin
      .from('pedidos_shopify')
      .select('*', { count: 'exact' })
      .order('shopify_created_at', { ascending: false });

    if (estado !== 'todos') {
      query = query.eq('estado_financiero', estado);
    }

    if (busqueda) {
      query = query.or(
        `shopify_order_number.ilike.%${busqueda}%,nombre_cliente.ilike.%${busqueda}%,email.ilike.%${busqueda}%,telefono.ilike.%${busqueda}%`
      );
    }

    const from = (pagina - 1) * porPagina;
    const to = from + porPagina - 1;
    query = query.range(from, to);

    const { data: pedidos, error, count } = await query;

    if (error) throw error;

    return NextResponse.json({
      success: true,
      pedidos: pedidos || [],
      total: count || 0,
      pagina,
      totalPaginas: Math.ceil((count || 0) / porPagina),
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
