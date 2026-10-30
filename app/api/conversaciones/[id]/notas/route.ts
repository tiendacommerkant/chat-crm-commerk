// GET  /api/conversaciones/[id]/notas — Notas internas de la conversación
// POST /api/conversaciones/[id]/notas — Nueva nota { contenido }
// Las notas solo las ve el equipo: nunca se envían al cliente ni las lee el bot.
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { asesorDeRequest } from '@/lib/sesion';
import { auditarRequest } from '@/lib/auditoria';

export const dynamic = 'force-dynamic';

const MIGRACION_PENDIENTE = 'Las notas internas se activan al correr la migración de atención en Supabase.';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { data, error } = await supabaseAdmin
    .from('notas_conversacion')
    .select('*')
    .eq('conversacion_id', params.id)
    .order('created_at', { ascending: true });
  if (error) return NextResponse.json({ success: true, notas: [], disponible: false, aviso: MIGRACION_PENDIENTE });
  return NextResponse.json({ success: true, notas: data || [], disponible: true });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const asesor = await asesorDeRequest(req);
  if (!asesor) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });

  const { contenido } = await req.json().catch(() => ({}));
  if (!contenido || typeof contenido !== 'string' || !contenido.trim()) {
    return NextResponse.json({ success: false, error: 'La nota está vacía' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('notas_conversacion')
    .insert({ conversacion_id: params.id, autor: asesor.email, autor_nombre: asesor.nombre, contenido: contenido.trim().slice(0, 2000) })
    .select()
    .single();
  if (error) return NextResponse.json({ success: false, error: MIGRACION_PENDIENTE }, { status: 503 });
  await auditarRequest(req, 'nota.crear', 'conversacion', params.id);
  return NextResponse.json({ success: true, nota: data });
}
