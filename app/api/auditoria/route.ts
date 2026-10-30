// GET /api/auditoria?dias=7&actor=&grupo= — Registro de actividad (solo administradores)
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { asesorDeRequest } from '@/lib/sesion';
import { ACCIONES } from '@/lib/auditoria';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const yo = await asesorDeRequest(req);
  if (!yo) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });
  if (yo.rol !== 'admin') return NextResponse.json({ success: false, error: 'Solo un administrador puede ver la actividad' }, { status: 403 });

  const url = new URL(req.url);
  const dias = Math.min(90, Math.max(1, Number(url.searchParams.get('dias')) || 7));
  const actor = url.searchParams.get('actor') || '';
  const grupo = url.searchParams.get('grupo') || ''; // prefijo: 'conversacion', 'mensaje', 'equipo'…

  let q = supabaseAdmin.from('auditoria').select('*')
    .gte('created_at', new Date(Date.now() - dias * 86_400_000).toISOString())
    .order('created_at', { ascending: false })
    .limit(500);
  if (actor) q = q.eq('actor', actor);
  if (grupo) q = q.like('accion', `${grupo}.%`);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ success: true, eventos: [], aviso: 'Falta correr la migración de la Fase 3 en Supabase (sql/migracion_2026_10_fase3.sql).' });
  }

  // Nombres de clientes para las acciones sobre conversaciones
  const convIds = Array.from(new Set((data || []).filter((e) => e.entidad === 'conversacion' && e.entidad_id).map((e) => e.entidad_id)));
  const nombres: Record<string, string> = {};
  if (convIds.length) {
    const { data: convs } = await supabaseAdmin.from('conversaciones').select('id, cliente:clientes(nombre, telefono)').in('id', convIds.slice(0, 300));
    for (const c of (convs as any[]) || []) nombres[c.id] = c.cliente?.nombre || c.cliente?.telefono || '';
  }

  const eventos = (data || []).map((e) => ({
    ...e,
    accion_legible: ACCIONES[e.accion] || e.accion,
    cliente: e.entidad === 'conversacion' ? nombres[e.entidad_id] || null : null,
  }));
  const actores = Array.from(new Map((data || []).map((e) => [e.actor, e.actor_nombre || e.actor])).entries())
    .map(([email, nombre]) => ({ email, nombre }));

  return NextResponse.json({ success: true, eventos, actores });
}
