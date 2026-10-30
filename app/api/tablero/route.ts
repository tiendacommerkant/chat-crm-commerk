// GET /api/tablero?dias=30 — Indicadores de atención, ventas del bot y satisfacción
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { calcularTablero } from '@/lib/tablero';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Lee todas las filas del periodo de a 1.000 (límite de Supabase por consulta)
async function todas(tabla: string, columnas: string, desde: string, filtro?: (q: any) => any): Promise<any[]> {
  const filas: any[] = [];
  for (let i = 0; i < 30; i++) {
    let q = supabaseAdmin.from(tabla).select(columnas).gte('created_at', desde)
      .order('created_at', { ascending: true }).range(i * 1000, i * 1000 + 999);
    if (filtro) q = filtro(q);
    const { data, error } = await q;
    if (error) return filas; // tabla sin migrar: el tablero muestra lo que hay
    filas.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return filas;
}

export async function GET(req: Request) {
  try {
    const dias = Math.min(180, Math.max(1, Number(new URL(req.url).searchParams.get('dias')) || 30));
    const desde = new Date(Date.now() - dias * 86_400_000).toISOString();

    const [mensajes, ventas, encuestas, leads, nuevas, pendientes] = await Promise.all([
      todas('mensajes', 'conversacion_id, tipo, created_at, metadata', desde),
      todas('ventas', 'referencia_pago, estado, total, created_at', desde),
      todas('encuestas', 'asesor, asesor_nombre, calificacion, comentario, created_at', desde),
      todas('leads_sedes', 'sede, created_at', desde),
      supabaseAdmin.from('conversaciones').select('id', { count: 'exact', head: true }).gte('created_at', desde),
      supabaseAdmin.from('conversaciones').select('pendiente_desde, updated_at').eq('estado_atencion', 'pendiente'),
    ]);

    const tablero = calcularTablero({
      desde,
      conversacionesNuevas: nuevas.count ?? 0,
      mensajes,
      ventas,
      encuestas,
      leads,
      pendientes: pendientes.data || [],
    });

    return NextResponse.json({ success: true, dias, desde, ...tablero });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
