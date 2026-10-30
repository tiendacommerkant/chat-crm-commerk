// POST /api/carritos/[id]/recover → Envía WhatsApp de recuperación manual
// Mismas reglas que el envío automático, salvo el horario y el límite semanal:
// aquí decide la persona del equipo.
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { recuperarCarrito } from '@/lib/recuperacion';

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

    const resultado = await recuperarCarrito(carrito, { manual: true });
    return NextResponse.json({ success: resultado.enviado, via: resultado.via, error: resultado.motivo });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
