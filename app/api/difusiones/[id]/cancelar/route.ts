// POST /api/difusiones/[id]/cancelar — Detiene una difusión (lo ya enviado no se puede recoger)
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { asesorDeRequest } from '@/lib/sesion';
import { auditarRequest } from '@/lib/auditoria';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const yo = await asesorDeRequest(req);
  if (!yo) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });
  if (yo.rol !== 'admin') return NextResponse.json({ success: false, error: 'Solo un administrador puede cancelar difusiones' }, { status: 403 });
  const { error } = await supabaseAdmin.from('difusiones').update({ estado: 'cancelada' }).eq('id', params.id).eq('estado', 'enviando');
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  await auditarRequest(req, 'difusion.cancelar', 'difusion', params.id);
  return NextResponse.json({ success: true });
}
