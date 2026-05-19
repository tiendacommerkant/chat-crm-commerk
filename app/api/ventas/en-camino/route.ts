import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { enviarPedidoEnCamino } from '@/lib/whatsapp-templates';

export async function POST(req: Request) {
  try {
    const { ventaId } = await req.json();
    if (!ventaId) {
      return NextResponse.json({ error: 'ventaId requerido' }, { status: 400 });
    }

    const { data: venta, error } = await supabaseAdmin
      .from('ventas')
      .select('id, producto_nombre, direccion_envio, cliente:clientes(nombre, telefono)')
      .eq('id', ventaId)
      .maybeSingle();

    if (error || !venta) {
      return NextResponse.json({ error: 'Venta no encontrada' }, { status: 404 });
    }

    const cliente = venta.cliente as any;
    const telefono: string = cliente?.telefono || '';
    const nombre: string = cliente?.nombre || 'Cliente';
    const producto: string = venta.producto_nombre || '';
    const direccion: string = (venta as any).direccion_envio || 'Sin especificar';

    if (!telefono) {
      return NextResponse.json({ error: 'El cliente no tiene teléfono registrado' }, { status: 400 });
    }

    const ok = await enviarPedidoEnCamino(telefono, nombre, producto, direccion);

    return NextResponse.json({ ok });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
