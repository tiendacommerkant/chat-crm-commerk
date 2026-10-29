// PATCH /api/conversaciones/[id]/bot-toggle — Activar/desactivar bot para una conversación
// Apagar el bot = el asesor toma la conversación; encenderlo = vuelve a Sofi.
import { NextResponse } from 'next/server';
import { asesorDeRequest } from '@/lib/sesion';
import { tomarConversacion, devolverAlBot } from '@/lib/atencion';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const { bot_activo } = await req.json();

    if (typeof bot_activo !== 'boolean') {
      return NextResponse.json({ success: false, error: 'bot_activo debe ser boolean' }, { status: 400 });
    }

    if (bot_activo) {
      await devolverAlBot(params.id);
    } else {
      const asesor = await asesorDeRequest(req);
      if (!asesor) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });
      await tomarConversacion(params.id, asesor);
    }

    return NextResponse.json({ success: true, bot_activo });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
