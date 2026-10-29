// POST /api/conversaciones/[id]/reply — Responder a un cliente desde el dashboard
import { NextResponse } from 'next/server';
import { enviarMensajeWhatsApp } from '@/lib/whatsapp';
import { asesorDeRequest } from '@/lib/sesion';
import { obtenerDestino, registrarMensajeAsesor, traducirErrorWhatsApp } from '@/lib/chat-asesor';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const asesor = await asesorDeRequest(req);
    if (!asesor) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });

    const { mensaje } = await req.json();
    if (!mensaje?.trim()) {
      return NextResponse.json({ success: false, error: 'Mensaje vacío' }, { status: 400 });
    }

    const destino = await obtenerDestino(params.id);
    if (!destino) {
      return NextResponse.json({ success: false, error: 'Conversación no encontrada o cliente sin teléfono' }, { status: 404 });
    }

    const resultado = await enviarMensajeWhatsApp(destino.telefono, mensaje.trim());
    if (!resultado.success) {
      return NextResponse.json({ success: false, error: traducirErrorWhatsApp(resultado.error) }, { status: 502 });
    }

    const nuevoMensaje = await registrarMensajeAsesor(destino, mensaje.trim(), {
      tipo_wa: 'text',
      whatsapp_message_id: resultado.messageId,
    }, asesor);

    return NextResponse.json({ success: true, mensaje: nuevoMensaje });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
