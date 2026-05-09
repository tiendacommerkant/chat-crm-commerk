// POST /api/carritos/[id]/recover → Envía WhatsApp de recuperación manual
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { notificarCarritoAbandonado } from '@/lib/notificaciones';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const { data: carrito, error } = await supabaseAdmin
      .from('carritos_abandonados')
      .select('*')
      .eq('id', params.id)
      .single();

    if (error || !carrito) {
      return NextResponse.json({ success: false, error: 'Carrito no encontrado' }, { status: 404 });
    }

    if (!carrito.telefono) {
      return NextResponse.json({ success: false, error: 'Este carrito no tiene teléfono registrado' }, { status: 400 });
    }

    if (carrito.estado === 'convertido') {
      return NextResponse.json({ success: false, error: 'Este carrito ya fue convertido en pedido' }, { status: 400 });
    }

    const resultado = await notificarCarritoAbandonado({
      id: carrito.id,
      shopify_checkout_id: carrito.shopify_checkout_id,
      nombre: carrito.nombre,
      telefono: carrito.telefono,
      total: carrito.total,
      url_checkout: carrito.url_checkout,
      items: carrito.items || [],
    });

    return NextResponse.json({ success: resultado.success, error: resultado.error });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
