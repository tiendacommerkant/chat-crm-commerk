import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { enviarCarritoAbandonado } from '@/lib/whatsapp-templates';
import { formatearPrecioCOP } from '@/lib/shopify';

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get('secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const hace24horas = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: ventas, error } = await supabaseAdmin
    .from('ventas')
    .select('*, clientes(*)')
    .eq('estado', 'pendiente')
    .lt('created_at', hace24horas)
    .eq('carrito_recordatorio_enviado', false)
    .limit(50);

  if (error) {
    console.error('[Cron carrito-abandonado] Error consultando ventas:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const resultados: { id: string; ok: boolean }[] = [];

  for (const venta of ventas || []) {
    const cliente = venta.clientes as any;
    const telefono: string = cliente?.telefono || '';
    const nombre: string = cliente?.nombre || 'Cliente';
    const producto: string = venta.producto_nombre || '';
    const precio: string = formatearPrecioCOP(Number(venta.total));

    let ok = false;
    if (telefono) {
      ok = await enviarCarritoAbandonado(telefono, nombre, producto, precio);
    }

    // Marcar como enviado para no reenviar
    await supabaseAdmin
      .from('ventas')
      .update({ carrito_recordatorio_enviado: true })
      .eq('id', venta.id);

    resultados.push({ id: venta.id, ok });
  }

  return NextResponse.json({ procesadas: resultados.length, resultados });
}
