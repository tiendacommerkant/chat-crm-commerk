// PATCH /api/conversaciones/[id]/atencion — Acciones de la bandeja de atención
//   { accion: 'tomar' }                         → el asesor de la sesión la toma
//   { accion: 'asignar', email, nombre }        → se asigna a otro asesor
//   { accion: 'devolver_bot' }                  → caso resuelto, vuelve a Sofi
import { NextResponse } from 'next/server';
import { asesorDeRequest } from '@/lib/sesion';
import { tomarConversacion, asignarConversacion, devolverAlBot } from '@/lib/atencion';
import { enviarEncuestaSiCorresponde } from '@/lib/encuesta';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const asesor = await asesorDeRequest(req);
    if (!asesor) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });

    const { accion, email, nombre } = await req.json().catch(() => ({}));

    if (accion === 'tomar') {
      await tomarConversacion(params.id, asesor);
    } else if (accion === 'asignar') {
      if (!email || typeof email !== 'string') {
        return NextResponse.json({ success: false, error: 'Falta el asesor' }, { status: 400 });
      }
      await asignarConversacion(params.id, { email, nombre: typeof nombre === 'string' && nombre ? nombre : email });
    } else if (accion === 'devolver_bot') {
      await devolverAlBot(params.id);
      // Caso resuelto por un asesor: se le pregunta al cliente cómo le fue
      const encuesta = await enviarEncuestaSiCorresponde(params.id).catch(() => false);
      return NextResponse.json({ success: true, encuesta });
    } else {
      return NextResponse.json({ success: false, error: 'Acción no válida' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
