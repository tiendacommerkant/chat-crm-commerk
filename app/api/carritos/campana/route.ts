// /api/carritos/campana — campaña única para recordar carritos de varios días atrás
//   GET    → campaña actual y cuántas personas recibirían el recordatorio
//   POST   → { dias, inicia } la programa (solo administradores)
//   DELETE → la cancela (solo administradores)
// El envío lo hace avanzarCampanaCarritos (lib/recuperacion.ts) con las reglas
// de siempre: horario, baja de publicidad, ya compró, asesor, uno por persona.
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { asesorDeRequest } from '@/lib/sesion';
import { auditarRequest } from '@/lib/auditoria';
import { celularColombiano } from '@/lib/carritos';
import { CLAVE_CAMPANA, leerCampanaCarritos, type CampanaCarritos } from '@/lib/recuperacion';

export const dynamic = 'force-dynamic';

async function personasDesde(desde: string): Promise<number> {
  const { data } = await supabaseAdmin.from('carritos_abandonados').select('telefono')
    .eq('estado', 'abandonado').eq('notificado_whatsapp', false).not('telefono', 'is', null)
    .gte('shopify_updated_at', desde).limit(1000);
  return new Set(((data as any[]) || []).map((c) => celularColombiano(c.telefono)).filter(Boolean)).size;
}

export async function GET() {
  const campana = await leerCampanaCarritos();
  const activa = campana && ['pendiente', 'en_curso'].includes(campana.estado);
  return NextResponse.json({
    success: true,
    campana,
    personas: activa ? await personasDesde(campana!.carritos_desde) : null,
    // Para ofrecer una campaña nueva: cuántas personas hay en los últimos 30 días
    personas_30_dias: activa ? null : await personasDesde(new Date(Date.now() - 30 * 86_400_000).toISOString()),
  });
}

export async function POST(req: Request) {
  const yo = await asesorDeRequest(req);
  if (!yo) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });
  if (yo.rol !== 'admin') return NextResponse.json({ success: false, error: 'Solo un administrador puede programar la campaña' }, { status: 403 });

  const b = await req.json().catch(() => ({}));
  const dias = Math.round(Number(b.dias));
  if (!(dias >= 1 && dias <= 60)) return NextResponse.json({ success: false, error: 'Elige entre 1 y 60 días' }, { status: 400 });
  const inicia = b.inicia ? new Date(b.inicia) : new Date();
  if (isNaN(inicia.getTime())) return NextResponse.json({ success: false, error: 'Fecha de inicio inválida' }, { status: 400 });

  const actual = await leerCampanaCarritos();
  if (actual && ['pendiente', 'en_curso'].includes(actual.estado)) {
    return NextResponse.json({ success: false, error: 'Ya hay una campaña programada o en curso' }, { status: 409 });
  }

  const campana: CampanaCarritos = {
    carritos_desde: new Date(Date.now() - dias * 86_400_000).toISOString(),
    inicia: inicia.toISOString(),
    estado: 'pendiente',
  };
  const { error } = await supabaseAdmin.from('configuracion').upsert({
    clave: CLAVE_CAMPANA, valor: campana, actualizado_por: yo.email, updated_at: new Date().toISOString(),
  }, { onConflict: 'clave' });
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  await auditarRequest(req, 'carritos.campana', 'configuracion', CLAVE_CAMPANA, { dias, inicia: campana.inicia });
  return NextResponse.json({ success: true, campana, personas: await personasDesde(campana.carritos_desde) });
}

export async function DELETE(req: Request) {
  const yo = await asesorDeRequest(req);
  if (!yo) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });
  if (yo.rol !== 'admin') return NextResponse.json({ success: false, error: 'Solo un administrador puede cancelar la campaña' }, { status: 403 });

  const actual = await leerCampanaCarritos();
  if (!actual || !['pendiente', 'en_curso'].includes(actual.estado)) {
    return NextResponse.json({ success: false, error: 'No hay una campaña activa' }, { status: 404 });
  }
  await supabaseAdmin.from('configuracion').upsert({
    clave: CLAVE_CAMPANA, valor: { ...actual, estado: 'cancelada', terminada: new Date().toISOString() },
    actualizado_por: yo.email, updated_at: new Date().toISOString(),
  }, { onConflict: 'clave' });
  await auditarRequest(req, 'carritos.campana_cancelar', 'configuracion', CLAVE_CAMPANA, { enviados: actual.enviados || 0 });
  return NextResponse.json({ success: true });
}
