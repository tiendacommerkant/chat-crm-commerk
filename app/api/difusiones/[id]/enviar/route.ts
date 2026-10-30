// POST /api/difusiones/[id]/enviar — Envía el siguiente lote (el CRM lo llama en bucle)
import { NextResponse } from 'next/server';
import { asesorDeRequest } from '@/lib/sesion';
import { auditarRequest } from '@/lib/auditoria';
import { enviarLote } from '@/lib/difusiones';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const yo = await asesorDeRequest(req);
  if (!yo) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });
  if (yo.rol !== 'admin') return NextResponse.json({ success: false, error: 'Solo un administrador puede enviar difusiones' }, { status: 403 });
  try {
    const avance = await enviarLote(params.id);
    if (avance.estado === 'completada' && avance.pendientes === 0) {
      await auditarRequest(req, 'difusion.enviar', 'difusion', params.id, { total: avance.total, enviados: avance.enviados, fallidos: avance.fallidos });
    }
    return NextResponse.json({ success: true, ...avance });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
