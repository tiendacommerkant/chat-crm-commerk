// POST /api/conversaciones/[id]/reply — Responder a un cliente desde el dashboard
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { enviarMensajeWhatsApp } from '@/lib/whatsapp';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    const { mensaje } = await req.json();

    if (!mensaje?.trim()) {
      return NextResponse.json({ success: false, error: 'Mensaje vacío' }, { status: 400 });
    }

    // Obtener conversación + teléfono del cliente
    const { data: conv, error: errConv } = await supabaseAdmin
      .from('conversaciones')
      .select('id, estado, cliente:clientes(id, telefono, nombre)')
      .eq('id', id)
      .single();

    if (errConv || !conv) {
      return NextResponse.json({ success: false, error: 'Conversación no encontrada' }, { status: 404 });
    }

    const cliente = conv.cliente as any;
    if (!cliente?.telefono) {
      return NextResponse.json({ success: false, error: 'Cliente sin teléfono' }, { status: 400 });
    }

    // Enviar mensaje por WhatsApp
    const resultado = await enviarMensajeWhatsApp(cliente.telefono, mensaje.trim());

    if (!resultado.success) {
      return NextResponse.json({ success: false, error: resultado.error }, { status: 502 });
    }

    // Guardar en mensajes con metadata de agente humano
    const { data: nuevoMensaje } = await supabaseAdmin
      .from('mensajes')
      .insert({
        conversacion_id: id,
        tipo: 'bot',
        contenido: mensaje.trim(),
        metadata: {
          tipo_wa: 'text',
          enviado_por: 'agente',
          whatsapp_message_id: resultado.messageId,
        },
      })
      .select()
      .single();

    // Actualizar updated_at de la conversación
    await supabaseAdmin
      .from('conversaciones')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', id);

    return NextResponse.json({ success: true, mensaje: nuevoMensaje });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
