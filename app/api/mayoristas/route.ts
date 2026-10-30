// GET   /api/mayoristas?sede=&estado= — Leads mayoristas que el bot envió a las sedes
// PATCH /api/mayoristas — { id, estado?, nota? } seguimiento del lead
// Una cuenta de sede solo ve y edita los de su tienda (la sede sale de su
// sesión firmada, nunca de la petición). Administradores y asesores ven todos.
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { asesorDeRequest } from '@/lib/sesion';
import { auditarRequest } from '@/lib/auditoria';
import { SEDES_FISICAS } from '@/lib/sedes';

export const dynamic = 'force-dynamic';

const ESTADOS_LEAD = ['nuevo', 'contactado', 'vendido', 'no_concretado'] as const;
const NOMBRES_SEDES = Object.values(SEDES_FISICAS).map((s) => s.nombre);
const MIGRACION = 'Falta correr sql/migracion_2026_10_sedes.sql en Supabase para guardar el seguimiento';

export async function GET(req: Request) {
  const yo = await asesorDeRequest(req);
  if (!yo) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });
  if (yo.rol === 'sede' && !yo.sede) {
    return NextResponse.json({ success: false, error: 'Tu cuenta no tiene una sede asignada. Pídele a un administrador que la configure en Equipo.' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const sede = yo.rol === 'sede' ? yo.sede! : searchParams.get('sede');

  // Los leads empresariales ("Ventas Empresariales") se gestionan en el embudo
  let q = supabaseAdmin.from('leads_sedes').select('*').in('sede', NOMBRES_SEDES)
    .order('created_at', { ascending: false }).limit(500);
  if (sede) q = q.eq('sede', sede);
  const { data, error } = await q;
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  const leads = (data || []).map((l: any) => ({ ...l, estado: l.estado || 'nuevo' }));
  const contadores = Object.fromEntries(ESTADOS_LEAD.map((e) => [e, leads.filter((l) => l.estado === e).length]));
  return NextResponse.json({
    success: true,
    leads,
    contadores,
    yo: { rol: yo.rol, sede: yo.sede || null },
    sedes: yo.rol === 'sede' ? [yo.sede] : NOMBRES_SEDES,
    seguimiento: data?.length ? 'estado' in (data[0] as any) : true,
  });
}

export async function PATCH(req: Request) {
  const yo = await asesorDeRequest(req);
  if (!yo) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });

  const b = await req.json().catch(() => ({}));
  if (!b.id) return NextResponse.json({ success: false, error: 'Falta el lead' }, { status: 400 });
  const cambios: Record<string, any> = {};
  if (b.estado !== undefined) {
    if (!ESTADOS_LEAD.includes(b.estado)) return NextResponse.json({ success: false, error: 'Estado no válido' }, { status: 400 });
    cambios.estado = b.estado;
  }
  if (b.nota !== undefined) cambios.nota = String(b.nota || '').slice(0, 1000).trim() || null;
  if (!Object.keys(cambios).length) return NextResponse.json({ success: false, error: 'Nada para guardar' }, { status: 400 });

  const { data: lead } = await supabaseAdmin.from('leads_sedes').select('id, sede, nombre_cliente').eq('id', b.id).maybeSingle();
  if (!lead || !NOMBRES_SEDES.includes((lead as any).sede)) return NextResponse.json({ success: false, error: 'Lead no encontrado' }, { status: 404 });
  if (yo.rol === 'sede' && (lead as any).sede !== yo.sede) {
    return NextResponse.json({ success: false, error: 'Este lead es de otra sede' }, { status: 403 });
  }

  const { error } = await supabaseAdmin.from('leads_sedes')
    .update({ ...cambios, atendido_por: yo.nombre, updated_at: new Date().toISOString() })
    .eq('id', b.id);
  if (error) {
    const falta = /estado|nota|atendido_por|updated_at/.test(error.message);
    return NextResponse.json({ success: false, error: falta ? MIGRACION : error.message }, { status: falta ? 503 : 500 });
  }
  await auditarRequest(req, 'lead.actualizar', 'lead', b.id, { sede: (lead as any).sede, cliente: (lead as any).nombre_cliente, ...cambios });
  return NextResponse.json({ success: true });
}
