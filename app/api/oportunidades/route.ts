// GET   /api/oportunidades — Embudo: abiertas y cerradas en los últimos 60 días
// POST  /api/oportunidades — Nueva oportunidad manual { empresa, contacto, telefono, correo, necesidad, valor_estimado, unidades }
// PATCH /api/oportunidades — Editar { id, ...cambios } (incluye mover de etapa)
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { asesorDeRequest } from '@/lib/sesion';
import { auditarRequest } from '@/lib/auditoria';
import { ETAPAS, type Etapa } from '@/lib/oportunidades';

export const dynamic = 'force-dynamic';

const MIGRACION = 'Falta correr la migración de la Fase 3 en Supabase (sql/migracion_2026_10_fase3.sql).';
const CAMPOS_TEXTO = ['empresa', 'contacto', 'telefono', 'correo', 'necesidad', 'notas', 'motivo_perdida'] as const;

function limpiar(body: any): Record<string, any> {
  const cambios: Record<string, any> = {};
  for (const c of CAMPOS_TEXTO) {
    if (body[c] !== undefined) cambios[c] = typeof body[c] === 'string' && body[c].trim() ? body[c].trim().slice(0, 2000) : null;
  }
  for (const c of ['valor_estimado', 'unidades'] as const) {
    if (body[c] !== undefined) {
      const n = body[c] === '' || body[c] === null ? null : Number(body[c]);
      cambios[c] = n === null || (Number.isFinite(n) && n >= 0) ? n : undefined;
      if (cambios[c] === undefined) delete cambios[c];
    }
  }
  return cambios;
}

export async function GET() {
  const hace60 = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('oportunidades')
    .select('*, cliente:clientes(id, nombre, telefono)')
    .or(`etapa.in.(nueva,contactada,cotizada),updated_at.gte.${hace60}`)
    .order('updated_at', { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ success: true, oportunidades: [], aviso: MIGRACION });
  return NextResponse.json({ success: true, oportunidades: data || [] });
}

export async function POST(req: Request) {
  const yo = await asesorDeRequest(req);
  if (!yo) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const datos = limpiar(body);
  if (!datos.empresa && !datos.contacto) {
    return NextResponse.json({ success: false, error: 'Escribe la empresa o el nombre del contacto' }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin.from('oportunidades')
    .insert({ ...datos, etapa: 'nueva', asignado_a: yo.email, asignado_nombre: yo.nombre })
    .select().single();
  if (error) return NextResponse.json({ success: false, error: MIGRACION }, { status: 503 });
  await auditarRequest(req, 'oportunidad.crear', 'oportunidad', data.id, { empresa: datos.empresa || datos.contacto });
  return NextResponse.json({ success: true, oportunidad: data });
}

export async function PATCH(req: Request) {
  const yo = await asesorDeRequest(req);
  if (!yo) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ success: false, error: 'Falta la oportunidad' }, { status: 400 });

  const cambios: Record<string, any> = limpiar(body);
  if (body.etapa !== undefined) {
    if (!ETAPAS.includes(body.etapa as Etapa)) return NextResponse.json({ success: false, error: 'Etapa no válida' }, { status: 400 });
    if (body.etapa === 'perdida' && !(cambios.motivo_perdida || body.motivo_perdida)) {
      return NextResponse.json({ success: false, error: 'Cuéntanos por qué se perdió: sirve para mejorar la próxima' }, { status: 400 });
    }
    cambios.etapa = body.etapa;
    cambios.cerrada_en = ['ganada', 'perdida'].includes(body.etapa) ? new Date().toISOString() : null;
  }
  if (body.asignar_a_mi) { cambios.asignado_a = yo.email; cambios.asignado_nombre = yo.nombre; }
  if (!Object.keys(cambios).length) return NextResponse.json({ success: false, error: 'Nada para guardar' }, { status: 400 });

  const { data, error } = await supabaseAdmin.from('oportunidades')
    .update({ ...cambios, updated_at: new Date().toISOString() })
    .eq('id', body.id).select().single();
  if (error) return NextResponse.json({ success: false, error: error.message.includes('oportunidades') ? MIGRACION : error.message }, { status: 500 });

  await auditarRequest(req, cambios.etapa ? 'oportunidad.etapa' : 'oportunidad.editar', 'oportunidad', body.id,
    cambios.etapa ? { etapa: cambios.etapa, empresa: data.empresa || data.contacto } : { campos: Object.keys(cambios) });
  return NextResponse.json({ success: true, oportunidad: data });
}
