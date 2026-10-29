// GET  /api/conversaciones — Lista conversaciones con cliente y último mensaje
// POST /api/conversaciones — Inicia una conversación nueva con un cliente
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { enviarMensajeWhatsApp } from '@/lib/whatsapp';
import { asesorDeRequest } from '@/lib/sesion';
import { tomarConversacion } from '@/lib/atencion';
import { traducirErrorWhatsApp } from '@/lib/chat-asesor';

export const dynamic = 'force-dynamic';

// Bandejas de la atención:
//   pendientes → el bot la pasó a un asesor y nadie la ha tomado
//   mias       → las que atiende el asesor de la sesión
//   bot        → las que atiende Sofi
//   todas
async function consultarConversaciones(
  filtros: { estado: string; etiqueta: string; bandeja: string; email: string | null },
  conBandejas: boolean
) {
  let query = supabaseAdmin
    .from('conversaciones')
    .select(`*, cliente:clientes(*), mensajes(id, tipo, contenido, metadata, created_at)`)
    .order('updated_at', { ascending: false })
    // Solo el último mensaje de cada conversación: antes se traían todos
    .order('created_at', { foreignTable: 'mensajes', ascending: false })
    .limit(1, { foreignTable: 'mensajes' })
    .limit(100);

  if (filtros.estado !== 'todas') query = query.eq('estado', filtros.estado);
  if (filtros.etiqueta) query = query.eq('etiqueta', filtros.etiqueta);
  if (conBandejas) {
    if (filtros.bandeja === 'pendientes') query = query.eq('estado_atencion', 'pendiente');
    if (filtros.bandeja === 'mias') query = query.eq('estado_atencion', 'en_atencion').eq('asignado_a', filtros.email || '-');
    if (filtros.bandeja === 'bot') query = query.eq('estado_atencion', 'bot');
  }
  return query;
}

async function contar(filtro: (q: any) => any): Promise<number | null> {
  const { count, error } = await filtro(supabaseAdmin.from('conversaciones').select('id', { count: 'exact', head: true }));
  return error ? null : count ?? 0;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const busqueda = searchParams.get('q') || '';
    const estado = searchParams.get('estado') || 'todas';
    // Filtro por etiqueta (ej. "empresarial" para quien revisa ventas empresariales)
    const etiqueta = searchParams.get('etiqueta') || '';
    const bandeja = searchParams.get('bandeja') || 'todas';
    const asesor = await asesorDeRequest(req);
    const filtros = { estado, etiqueta, bandeja, email: asesor?.email || null };

    let { data, error } = await consultarConversaciones(filtros, true);
    let conBandejas = true;
    if (error && /estado_atencion|asignado_a/.test(error.message)) {
      // Migración de atención pendiente: se filtra con bot_activo como antes
      conBandejas = false;
      ({ data, error } = await consultarConversaciones(filtros, false));
    }
    if (error) throw error;

    let filas: any[] = data || [];
    if (!conBandejas && bandeja === 'pendientes') filas = filas.filter((c) => c.bot_activo === false);
    if (!conBandejas && bandeja === 'bot') filas = filas.filter((c) => c.bot_activo !== false);
    if (!conBandejas && bandeja === 'mias') filas = [];
    // La más antigua en espera va primero en Pendientes
    if (bandeja === 'pendientes') {
      filas.sort((a, b) => new Date(a.pendiente_desde || a.updated_at).getTime() - new Date(b.pendiente_desde || b.updated_at).getTime());
    }

    const conversaciones = filas.map((conv: any) => {
      const ultimoMensaje = (conv.mensajes || [])[0] || null;
      const estadoAtencion = conv.estado_atencion ?? (conv.bot_activo === false ? 'pendiente' : 'bot');
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
              enviado_por: ultimoMensaje.metadata?.enviado_por || null,
              created_at: ultimoMensaje.created_at,
            }
          : null,
        etiqueta: conv.etiqueta || null,
        bot_activo: conv.bot_activo !== false,
        estado_atencion: estadoAtencion,
        asignado_a: conv.asignado_a ?? null,
        asignado_nombre: conv.asignado_nombre ?? null,
        pendiente_desde: conv.pendiente_desde ?? null,
        motivo_transferencia: conv.motivo_transferencia ?? null,
        // El cliente escribió y aún nadie le contesta
        esperando_respuesta: !!ultimoMensaje && ultimoMensaje.tipo === 'user' && estadoAtencion !== 'bot',
      };
    });

    const [pendientes, mias] = conBandejas
      ? await Promise.all([
          contar((q) => q.eq('estado_atencion', 'pendiente')),
          asesor ? contar((q) => q.eq('estado_atencion', 'en_atencion').eq('asignado_a', asesor.email)) : Promise.resolve(0),
        ])
      : [await contar((q) => q.eq('bot_activo', false)), 0];

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

    return NextResponse.json({
      success: true,
      conversaciones: filtradas,
      contadores: { pendientes, mias },
      bandejas_disponibles: conBandejas,
      yo: asesor,
    });
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
    if (!resultado.success) {
      // Se abre igual la conversación para que el asesor pueda mandar una plantilla
      return NextResponse.json({
        success: false,
        conversacion_id: conversacionId,
        error: traducirErrorWhatsApp(resultado.error),
      }, { status: 502 });
    }

    const asesor = await asesorDeRequest(req);
    await supabaseAdmin.from('mensajes').insert({
      conversacion_id: conversacionId,
      tipo: 'bot',
      contenido: mensaje.trim(),
      metadata: {
        tipo_wa: 'text',
        enviado_por: 'agente',
        asesor: asesor?.email || null,
        asesor_nombre: asesor?.nombre || null,
        whatsapp_message_id: resultado.messageId || null,
      },
    });

    // Quien inicia la conversación la atiende
    if (asesor) await tomarConversacion(conversacionId, asesor);

    return NextResponse.json({
      success: true,
      conversacion_id: conversacionId,
      whatsapp: resultado,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
