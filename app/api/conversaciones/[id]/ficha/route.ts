// GET /api/conversaciones/[id]/ficha — Todo lo del cliente al lado del chat:
// datos, compras en Shopify, links de pago del bot, carritos abandonados y si
// la ventana de 24 h de WhatsApp sigue abierta.
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const VENTANA_MS = 24 * 60 * 60 * 1000;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const { data: conv, error } = await supabaseAdmin
      .from('conversaciones')
      .select('*, cliente:clientes(*)')
      .eq('id', params.id)
      .maybeSingle();
    if (error || !conv) return NextResponse.json({ success: false, error: 'Conversación no encontrada' }, { status: 404 });

    const cliente = (conv as any).cliente || {};
    const telefono: string | null = cliente.telefono || null;

    const [ultimoUser, pedidosTodos, ventas, carritos, previas] = await Promise.all([
      supabaseAdmin.from('mensajes').select('created_at').eq('conversacion_id', params.id).eq('tipo', 'user')
        .order('created_at', { ascending: false }).limit(1).maybeSingle(),
      telefono
        ? supabaseAdmin.from('pedidos_shopify')
            .select('shopify_order_number, total, estado_financiero, estado_fulfillment, shopify_created_at, items')
            .or(`cliente_id.eq.${cliente.id},telefono.eq.${telefono}`)
            .order('shopify_created_at', { ascending: false }).limit(50)
        : Promise.resolve({ data: [] as any[] }),
      supabaseAdmin.from('ventas').select('producto_nombre, total, estado, link_pago, created_at')
        .eq('cliente_id', cliente.id).order('created_at', { ascending: false }).limit(5),
      telefono
        ? supabaseAdmin.from('carritos_abandonados').select('total, estado, items, url_checkout, shopify_updated_at')
            .eq('telefono', telefono).order('shopify_updated_at', { ascending: false }).limit(3)
        : Promise.resolve({ data: [] as any[] }),
      supabaseAdmin.from('conversaciones').select('id', { count: 'exact', head: true }).eq('cliente_id', cliente.id),
    ]);

    const pedidos = (pedidosTodos as any).data || [];
    const pagados = pedidos.filter((p: any) => ['paid', 'partially_refunded'].includes(p.estado_financiero));
    const totalComprado = pagados.reduce((s: number, p: any) => s + (Number(p.total) || 0), 0);

    const ultimo = (ultimoUser as any).data?.created_at as string | undefined;
    const cierra = ultimo ? new Date(ultimo).getTime() + VENTANA_MS : null;

    return NextResponse.json({
      success: true,
      cliente,
      atencion: {
        estado: (conv as any).estado_atencion ?? ((conv as any).bot_activo === false ? 'en_atencion' : 'bot'),
        asignado_a: (conv as any).asignado_a ?? null,
        asignado_nombre: (conv as any).asignado_nombre ?? null,
        pendiente_desde: (conv as any).pendiente_desde ?? null,
        motivo: (conv as any).motivo_transferencia ?? null,
      },
      resumen: {
        total_comprado: totalComprado,
        pedidos_pagados: pagados.length,
        ticket_promedio: pagados.length ? Math.round(totalComprado / pagados.length) : 0,
        ultimo_pedido: pagados[0]?.shopify_created_at || null,
        conversaciones: (previas as any).count ?? 1,
      },
      pedidos: pedidos.slice(0, 5),
      ventas_bot: (ventas as any).data || [],
      carritos: (carritos as any).data || [],
      ventana: {
        ultimo_mensaje_cliente: ultimo || null,
        abierta: cierra ? cierra > Date.now() : false,
        cierra_en: cierra ? new Date(cierra).toISOString() : null,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
