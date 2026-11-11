// GET /api/conversaciones/[id]/tema — Tema sugerido para la plantilla
// "Retomar conversación" ({{2}}), sacado de los últimos mensajes del chat.
import { NextResponse } from 'next/server';
import { asesorDeRequest } from '@/lib/sesion';
import { sugerirTemaConversacion } from '@/lib/tema-conversacion';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const asesor = await asesorDeRequest(req);
  if (!asesor) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });
  try {
    const sugerido = await sugerirTemaConversacion(params.id);
    return NextResponse.json({ success: true, ...sugerido });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
