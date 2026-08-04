import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { enviarRecordatorioPago } from '@/lib/whatsapp-templates';
import { formatearPrecioCOP } from '@/lib/shopify';

// Puede recorrer muchos pedidos y enviar varias plantillas por corrida.
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

async function procesarRecordatorios() {
  // Ventana: pedidos pendientes creados hace MÁS de 10 min pero MENOS de 24h
  const hace10min = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const hace24h   = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: ventas, error } = await supabaseAdmin
    .from('ventas')
    .select('*, clientes(*)')
    .eq('estado', 'pendiente')
    .lt('created_at', hace10min)
    .gt('created_at', hace24h)
    .eq('recordatorio_enviado', false)
    .limit(200);

  if (error) {
    console.error('[Cron recordatorio-pago] Error consultando ventas:', error);
    return { error: error.message };
  }

  // Agrupar por referencia_pago — un carrito puede tener varias ventas (1 por producto)
  const grupos = new Map<string, any[]>();
  for (const v of ventas || []) {
    const ref = v.referencia_pago || v.id;
    if (!grupos.has(ref)) grupos.set(ref, []);
    grupos.get(ref)!.push(v);
  }

  const resultados: { referencia: string; ok: boolean }[] = [];

  for (const [referencia, items] of Array.from(grupos.entries())) {
    const primera = items[0];
    const cliente = primera.clientes as any;
    const telefono: string = cliente?.telefono || '';
    const nombre: string = cliente?.nombre || 'Cliente';

    // Resumen y total agregado de todo el pedido
    const totalPedido = items.reduce((s, v) => s + Number(v.total), 0);
    const total: string = formatearPrecioCOP(totalPedido);
    const resumenProductos = items
      .map((v) => `${v.producto_nombre} × ${v.cantidad}`)
      .join(', ');

    // ID del link de pago (último segmento de la URL) — mismo para todo el carrito
    const linkId: string = primera.link_pago
      ? primera.link_pago.split('/').filter(Boolean).pop() || ''
      : '';

    let ok = false;
    if (telefono && linkId) {
      ok = await enviarRecordatorioPago(telefono, nombre, resumenProductos, total, linkId);
    }

    // Marcar TODAS las ventas del grupo como recordadas (para no reenviar)
    await supabaseAdmin
      .from('ventas')
      .update({ recordatorio_enviado: true })
      .in('id', items.map((v) => v.id));

    // Guardar en la conversación para que aparezca en el CRM
    if (ok && primera.conversacion_id) {
      const contenido =
        `⏰ *Recordatorio de pago enviado automáticamente*\n\n` +
        `Hola ${nombre.split(' ')[0]}, te recordamos que tienes un pago pendiente por *${resumenProductos}* por ${total}.\n\n` +
        `Puedes completar tu pago aquí: https://checkout.wompi.co/l/${linkId}`;

      await supabaseAdmin.from('mensajes').insert({
        conversacion_id: primera.conversacion_id,
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
        .eq('id', primera.conversacion_id);
    }

    resultados.push({ referencia, ok });
  }

  return { procesadas: resultados.length, resultados };
}

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const resultado = await procesarRecordatorios();
  const status = (resultado as any).error ? 500 : 200;
  return NextResponse.json(resultado, { status });
}

// Supabase pg_cron usa POST vía pg_net
export async function POST(req: Request) {
  return GET(req);
}
