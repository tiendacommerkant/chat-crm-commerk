// GET  /api/difusiones — Historial de difusiones
// POST /api/difusiones — Crea una difusión y su lista de destinatarios (solo administradores)
//   { nombre, plantilla, idioma, categoria, cuerpo: string[], boton?: string, texto, segmento }
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { asesorDeRequest } from '@/lib/sesion';
import { auditarRequest } from '@/lib/auditoria';
import { obtenerAudiencia, type Segmento } from '@/lib/difusiones';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MIGRACION = 'Falta correr la migración de la Fase 3 en Supabase (sql/migracion_2026_10_fase3.sql).';

export async function GET() {
  const { data, error } = await supabaseAdmin.from('difusiones').select('*').order('created_at', { ascending: false }).limit(100);
  if (error) return NextResponse.json({ success: true, difusiones: [], aviso: MIGRACION });
  return NextResponse.json({ success: true, difusiones: data || [] });
}

export async function POST(req: Request) {
  const yo = await asesorDeRequest(req);
  if (!yo) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });
  if (yo.rol !== 'admin') return NextResponse.json({ success: false, error: 'Solo un administrador puede enviar difusiones' }, { status: 403 });

  const b = await req.json().catch(() => ({}));
  const nombre = String(b.nombre || '').trim();
  if (!nombre || !b.plantilla) return NextResponse.json({ success: false, error: 'Falta el nombre o la plantilla' }, { status: 400 });
  const cuerpo: string[] = Array.isArray(b.cuerpo) ? b.cuerpo.map((x: any) => String(x ?? '').trim()) : [];
  if (cuerpo.some((x) => !x)) return NextResponse.json({ success: false, error: 'Completa todos los campos de la plantilla' }, { status: 400 });

  const segmento: Segmento = b.segmento || {};
  const audiencia = await obtenerAudiencia(segmento);
  if (!audiencia.length) return NextResponse.json({ success: false, error: 'Ningún cliente cumple ese segmento' }, { status: 400 });

  const { data: dif, error } = await supabaseAdmin.from('difusiones').insert({
    nombre: nombre.slice(0, 120),
    plantilla: b.plantilla,
    idioma: b.idioma || 'es',
    categoria: b.categoria || null,
    parametros: { cuerpo, boton: b.boton || null, texto: String(b.texto || '').slice(0, 2000) },
    segmento,
    total: audiencia.length,
    estado: 'enviando',
    creado_por: yo.email,
    creado_nombre: yo.nombre,
  }).select().single();
  if (error || !dif) return NextResponse.json({ success: false, error: MIGRACION }, { status: 503 });

  for (let i = 0; i < audiencia.length; i += 500) {
    const { error: e } = await supabaseAdmin.from('difusion_envios').insert(
      audiencia.slice(i, i + 500).map((a) => ({ difusion_id: dif.id, cliente_id: a.cliente_id, telefono: a.telefono, nombre: a.nombre }))
    );
    if (e) {
      await supabaseAdmin.from('difusiones').update({ estado: 'cancelada' }).eq('id', dif.id);
      return NextResponse.json({ success: false, error: `No se pudo preparar la lista: ${e.message}` }, { status: 500 });
    }
  }

  await auditarRequest(req, 'difusion.crear', 'difusion', dif.id, { nombre, plantilla: b.plantilla, total: audiencia.length });
  return NextResponse.json({ success: true, difusion: dif });
}
