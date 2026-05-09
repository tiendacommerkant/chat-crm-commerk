// GET /api/conversaciones/[id]/messages — Mensajes de una conversación
// Combina mensajes del chat + notificaciones WA enviadas al mismo cliente
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params;

    // Mensajes de la conversación
    const { data: mensajes, error: errMsg } = await supabaseAdmin
      .from('mensajes')
      .select('*')
      .eq('conversacion_id', id)
      .order('created_at', { ascending: true })
      .limit(200);

    if (errMsg) throw errMsg;

    // Obtener teléfono del cliente via conversación
    const { data: conv } = await supabaseAdmin
      .from('conversaciones')
      .select('cliente:clientes(telefono)')
      .eq('id', id)
      .single();

    const telefono = (conv?.cliente as any)?.telefono;

    // Notificaciones WA enviadas al mismo cliente (plantillas del sistema)
    let notificaciones: any[] = [];
    if (telefono) {
      const { data: notifs } = await supabaseAdmin
        .from('notificaciones_wa')
        .select('*')
        .eq('telefono', telefono)
        .order('created_at', { ascending: true })
        .limit(50);
      notificaciones = notifs || [];
    }

    // Normalizar notificaciones como mensajes especiales
    const notifsMapped = notificaciones.map((n) => ({
      id: `notif_${n.id}`,
      conversacion_id: id,
      tipo: 'bot' as const,
      contenido: n.mensaje || '',
      created_at: n.created_at,
      metadata: {
        tipo_wa: 'template',
        plantilla: n.tipo,
        referencia_id: n.referencia_id,
        estado_envio: n.estado,
        whatsapp_message_id: n.whatsapp_message_id,
        error: n.error,
      },
    }));

    // Combinar y ordenar por fecha
    const todos = [...(mensajes || []), ...notifsMapped].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    return NextResponse.json({ success: true, mensajes: todos });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
