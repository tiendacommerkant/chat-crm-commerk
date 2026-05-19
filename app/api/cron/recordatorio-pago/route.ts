import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { enviarRecordatorioPago } from '@/lib/whatsapp-templates';
import { formatearPrecioCOP } from '@/lib/shopify';

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const hace3horas = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

  const { data: ventas, error } = await supabaseAdmin
    .from('ventas')
    .select('*, clientes(*)')
    .eq('estado', 'pendiente')
    .lt('created_at', hace3horas)
    .eq('recordatorio_enviado', false)
    .limit(50);

  if (error) {
    console.error('[Cron recordatorio-pago] Error consultando ventas:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const resultados: { id: string; ok: boolean }[] = [];

  for (const venta of ventas || []) {
    const cliente = venta.clientes as any;
    const telefono: string = cliente?.telefono || '';
    const nombre: string = cliente?.nombre || 'Cliente';
    const producto: string = venta.producto_nombre || '';
    const total: string = formatearPrecioCOP(Number(venta.total));

    // Extraer el ID del link de pago (último segmento de la URL)
    const linkId: string = venta.link_pago
      ? venta.link_pago.split('/').filter(Boolean).pop() || ''
      : '';

    let ok = false;
    if (telefono && linkId) {
      ok = await enviarRecordatorioPago(telefono, nombre, producto, total, linkId);
    }

    // Marcar como enviado para no reenviar
    await supabaseAdmin
      .from('ventas')
      .update({ recordatorio_enviado: true })
      .eq('id', venta.id);

    // Guardar en la conversación para que aparezca en el CRM
    if (ok && venta.conversacion_id) {
      const contenido =
        `⏰ *Recordatorio de pago enviado automáticamente*\n\n` +
        `Hola ${nombre.split(' ')[0]}, te recordamos que tienes un pago pendiente por *${producto}* por ${total}.\n\n` +
        `Puedes completar tu pago aquí: https://checkout.wompi.co/l/${linkId}`;

      await supabaseAdmin.from('mensajes').insert({
        conversacion_id: venta.conversacion_id,
        tipo: 'bot',
        contenido,
        metadata: {
          tipo_wa: 'template',
          plantilla: 'recordatorio_pago',
          evento: 'recordatorio_automatico',
          awaiting: '',
        },
      });
      await supabaseAdmin
        .from('conversaciones')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', venta.conversacion_id);
    }

    resultados.push({ id: venta.id, ok });
  }

  return NextResponse.json({ procesadas: resultados.length, resultados });
}
