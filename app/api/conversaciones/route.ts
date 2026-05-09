// GET  /api/conversaciones — Lista conversaciones con cliente y último mensaje
// POST /api/conversaciones — Inicia una conversación nueva con un cliente
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { enviarMensajeWhatsApp } from '@/lib/whatsapp';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const busqueda = searchParams.get('q') || '';
    const estado = searchParams.get('estado') || 'todas';

    let query = supabaseAdmin
      .from('conversaciones')
      .select(`
        id, estado, created_at, updated_at,
        cliente:clientes(id, nombre, telefono, email, ciudad),
        mensajes(id, tipo, contenido, metadata, created_at)
      `)
      .order('updated_at', { ascending: false })
      .limit(100);

    if (estado !== 'todas') {
      query = query.eq('estado', estado);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Procesar para obtener último mensaje
    const conversaciones = (data || []).map((conv: any) => {
      const mensajes = conv.mensajes || [];
      const ultimoMensaje = mensajes.sort(
        (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )[0] || null;

      return {
        id: conv.id,
        estado: conv.estado,
        created_at: conv.created_at,
        updated_at: conv.updated_at,
        cliente: conv.cliente,
        ultimo_mensaje: ultimoMensaje
          ? {
              contenido: ultimoMensaje.contenido,
              tipo: ultimoMensaje.tipo,
              tipo_wa: ultimoMensaje.metadata?.tipo_wa || 'text',
              created_at: ultimoMensaje.created_at,
            }
          : null,
        total_mensajes: mensajes.length,
        no_leidos: mensajes.filter((m: any) => m.tipo === 'user').length,
      };
    });

    // Filtrar por búsqueda
    const filtradas = busqueda
      ? conversaciones.filter((c) => {
          const q = busqueda.toLowerCase();
          return (
            c.cliente?.nombre?.toLowerCase().includes(q) ||
            c.cliente?.telefono?.includes(q) ||
            c.ultimo_mensaje?.contenido?.toLowerCase().includes(q)
          );
        })
      : conversaciones;

    return NextResponse.json({ success: true, conversaciones: filtradas });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { cliente_id, mensaje } = await req.json();

    if (!cliente_id || !mensaje?.trim()) {
      return NextResponse.json({ success: false, error: 'cliente_id y mensaje requeridos' }, { status: 400 });
    }

    // Obtener cliente
    const { data: cliente, error: errCliente } = await supabaseAdmin
      .from('clientes')
      .select('*')
      .eq('id', cliente_id)
      .single();

    if (errCliente || !cliente) {
      return NextResponse.json({ success: false, error: 'Cliente no encontrado' }, { status: 404 });
    }

    if (!cliente.telefono) {
      return NextResponse.json({ success: false, error: 'El cliente no tiene teléfono registrado' }, { status: 400 });
    }

    // Buscar conversación activa o crear una nueva
    const { data: convExistente } = await supabaseAdmin
      .from('conversaciones')
      .select('id')
      .eq('cliente_id', cliente_id)
      .eq('estado', 'activa')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    let conversacionId: string;

    if (convExistente) {
      conversacionId = convExistente.id;
    } else {
      const { data: nuevaConv, error: errConv } = await supabaseAdmin
        .from('conversaciones')
        .insert({ cliente_id, estado: 'activa' })
        .select('id')
        .single();

      if (errConv || !nuevaConv) throw errConv;
      conversacionId = nuevaConv.id;
    }

    // Enviar mensaje por WhatsApp
    const resultado = await enviarMensajeWhatsApp(cliente.telefono, mensaje.trim());

    // Guardar en mensajes (aunque falle el envío WA, guardamos el intento)
    await supabaseAdmin.from('mensajes').insert({
      conversacion_id: conversacionId,
      tipo: 'bot',
      contenido: mensaje.trim(),
      metadata: {
        tipo_wa: 'text',
        enviado_por: 'agente',
        whatsapp_message_id: resultado.messageId || null,
        wa_error: resultado.error || null,
      },
    });

    await supabaseAdmin
      .from('conversaciones')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversacionId);

    return NextResponse.json({
      success: true,
      conversacion_id: conversacionId,
      whatsapp: resultado,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
