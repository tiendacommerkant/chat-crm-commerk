// GET    /api/respuestas-rapidas            — Lista (atajo + contenido)
// POST   /api/respuestas-rapidas            — Crea { atajo, contenido }
// PATCH  /api/respuestas-rapidas            — Edita { id, atajo?, contenido? }
// DELETE /api/respuestas-rapidas?id=…       — Borra
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { asesorDeRequest } from '@/lib/sesion';
import { auditarRequest } from '@/lib/auditoria';

export const dynamic = 'force-dynamic';

// Mientras no se corra la migración, el chat sigue teniendo estas respuestas
const PREDETERMINADAS = [
  { id: 'saludo', atajo: 'saludo', contenido: '¡Hola! 👋 Soy del equipo de Tienda Commerk. ¿En qué te puedo ayudar?' },
  { id: 'espera', atajo: 'espera', contenido: '⏳ Dame un momento, estoy verificando tu información.' },
  { id: 'pago', atajo: 'pago', contenido: '✅ Recibimos tu pago correctamente. ¡Gracias por tu compra!' },
  { id: 'camino', atajo: 'camino', contenido: '🚚 Tu pedido ya está en camino. Te avisamos cuando llegue.' },
  { id: 'cierre', atajo: 'cierre', contenido: '¡Gracias por escribirnos! 🙏 Si necesitas algo más, aquí estamos.' },
];
const MIGRACION_PENDIENTE = 'Para editar respuestas rápidas hay que correr la migración de atención en Supabase.';

function limpiarAtajo(atajo: unknown): string {
  return String(atajo || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
}

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('respuestas_rapidas')
    .select('id, atajo, contenido, orden')
    .order('orden', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) return NextResponse.json({ success: true, respuestas: PREDETERMINADAS, editable: false });
  return NextResponse.json({ success: true, respuestas: data || [], editable: true });
}

export async function POST(req: Request) {
  const asesor = await asesorDeRequest(req);
  if (!asesor) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const atajo = limpiarAtajo(body.atajo);
  const contenido = String(body.contenido || '').trim();
  if (!atajo || !contenido) {
    return NextResponse.json({ success: false, error: 'Escribe el atajo y el texto' }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin
    .from('respuestas_rapidas')
    .insert({ atajo, contenido: contenido.slice(0, 1500), orden: 100, creado_por: asesor.email })
    .select('id, atajo, contenido, orden')
    .single();
  if (error) return NextResponse.json({ success: false, error: MIGRACION_PENDIENTE }, { status: 503 });
  await auditarRequest(req, 'respuesta_rapida.crear', 'respuesta_rapida', data?.id ?? null, { atajo });
  return NextResponse.json({ success: true, respuesta: data });
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ success: false, error: 'Falta el id' }, { status: 400 });
  const cambios: Record<string, any> = { updated_at: new Date().toISOString() };
  if (body.atajo !== undefined) cambios.atajo = limpiarAtajo(body.atajo);
  if (body.contenido !== undefined) cambios.contenido = String(body.contenido).trim().slice(0, 1500);
  if (cambios.atajo === '' || cambios.contenido === '') {
    return NextResponse.json({ success: false, error: 'El atajo y el texto no pueden quedar vacíos' }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin
    .from('respuestas_rapidas').update(cambios).eq('id', body.id)
    .select('id, atajo, contenido, orden').single();
  if (error) return NextResponse.json({ success: false, error: MIGRACION_PENDIENTE }, { status: 503 });
  await auditarRequest(req, 'respuesta_rapida.editar', 'respuesta_rapida', body.id);
  return NextResponse.json({ success: true, respuesta: data });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ success: false, error: 'Falta el id' }, { status: 400 });
  const { error } = await supabaseAdmin.from('respuestas_rapidas').delete().eq('id', id);
  if (error) return NextResponse.json({ success: false, error: MIGRACION_PENDIENTE }, { status: 503 });
  await auditarRequest(req, 'respuesta_rapida.borrar', 'respuesta_rapida', id);
  return NextResponse.json({ success: true });
}
