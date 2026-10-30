// GET /api/configuracion — Horario de atención y encuesta (cualquier usuario del CRM)
// PUT /api/configuracion — Guarda { horario?, encuesta_activa? } (solo administradores)
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { asesorDeRequest } from '@/lib/sesion';
import {
  leerConfiguracion, limpiarCacheConfiguracion, normalizarHorario,
  describirHorario, dentroDeHorario, proximaApertura, avisoFueraDeHorario,
} from '@/lib/horario';
import { auditarRequest } from '@/lib/auditoria';

export const dynamic = 'force-dynamic';

const MIGRACION = 'Falta correr la migración de la Fase 2 en Supabase (sql/migracion_2026_10_fase2.sql).';

export async function GET() {
  limpiarCacheConfiguracion();
  const { error } = await supabaseAdmin.from('configuracion').select('clave').limit(1);
  const config = await leerConfiguracion();
  const horario = normalizarHorario(config.horario_atencion);
  return NextResponse.json({
    success: true,
    disponible: !error,
    aviso: error ? MIGRACION : null,
    horario,
    encuesta_activa: config.encuesta_activa !== false,
    resumen: horario ? {
      descripcion: describirHorario(horario),
      abierto_ahora: dentroDeHorario(horario),
      proxima_apertura: proximaApertura(horario),
      aviso_al_cliente: avisoFueraDeHorario(horario) || null,
    } : null,
  });
}

export async function PUT(req: Request) {
  const yo = await asesorDeRequest(req);
  if (!yo) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });
  if (yo.rol !== 'admin') return NextResponse.json({ success: false, error: 'Solo un administrador puede cambiar la configuración' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const filas: { clave: string; valor: any; actualizado_por: string; updated_at: string }[] = [];
  const ahora = new Date().toISOString();

  if (body.horario !== undefined) {
    if (body.horario === null) {
      filas.push({ clave: 'horario_atencion', valor: null, actualizado_por: yo.email, updated_at: ahora });
    } else {
      const horario = normalizarHorario(body.horario);
      if (!horario) {
        return NextResponse.json({ success: false, error: 'Revisa el horario: cada día abierto necesita hora de apertura y una de cierre posterior.' }, { status: 400 });
      }
      filas.push({ clave: 'horario_atencion', valor: horario, actualizado_por: yo.email, updated_at: ahora });
    }
  }
  if (typeof body.encuesta_activa === 'boolean') {
    filas.push({ clave: 'encuesta_activa', valor: body.encuesta_activa, actualizado_por: yo.email, updated_at: ahora });
  }
  if (!filas.length) return NextResponse.json({ success: false, error: 'Nada para guardar' }, { status: 400 });

  const { error } = await supabaseAdmin.from('configuracion').upsert(filas, { onConflict: 'clave' });
  if (error) return NextResponse.json({ success: false, error: MIGRACION }, { status: 503 });
  limpiarCacheConfiguracion();
  await auditarRequest(req, 'configuracion.editar', 'configuracion', null, { claves: filas.map((f) => f.clave) });
  return NextResponse.json({ success: true });
}
