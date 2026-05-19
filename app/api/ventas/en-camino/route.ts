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
      .select('id, producto_nombre, direccion_envio, conversacion_id, cliente:clientes(nombre, telefono)')
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

    // Guardar en la conversación para que aparezca en el CRM
    if (ok && (venta as any).conversacion_id) {
      const contenido =
        `🚚 *¡Tu pedido está en camino!*\n\n` +
        `Hola ${nombre.split(' ')[0]}, tu pedido de *${producto}* ha sido despachado.\n\n` +
        `📍 Dirección de entrega: ${direccion}\n\n` +
        `¡Gracias por comprar en Tienda Commerk! 🎉`;

      await supabaseAdmin.from('mensajes').insert({
        conversacion_id: (venta as any).conversacion_id,
        tipo: 'bot',
        contenido,
        metadata: {
          tipo_wa: 'template',
          plantilla: 'pedido_en_camino',
          evento: 'pedido_despachado',
          awaiting: '',
        },
      });
      await supabaseAdmin
        .from('conversaciones')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', (venta as any).conversacion_id);
    }

    return NextResponse.json({ ok });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
