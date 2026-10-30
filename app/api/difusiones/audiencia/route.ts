// POST /api/difusiones/audiencia — Cuántos clientes cumplen el segmento y cuánto costaría
// { segmento, categoria } → { total, muestra, costo_estimado }. No envía nada.
import { NextResponse } from 'next/server';
import { obtenerAudiencia, costoEstimado } from '@/lib/difusiones';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { segmento, categoria } = await req.json().catch(() => ({}));
    const audiencia = await obtenerAudiencia(segmento || {});
    return NextResponse.json({
      success: true,
      total: audiencia.length,
      muestra: audiencia.slice(0, 5).map((a) => a.nombre || 'Sin nombre'),
      costo_estimado: costoEstimado(audiencia.length, categoria),
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
