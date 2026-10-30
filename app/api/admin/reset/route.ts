import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { mismoSecreto } from '@/lib/sesion';
import { auditarRequest } from '@/lib/auditoria';

export async function POST(req: NextRequest) {
  // Borra TODOS los datos: además de la sesión (middleware) exige ADMIN_SECRET configurado
  const adminSecret = process.env.ADMIN_SECRET || '';
  if (!adminSecret || !mismoSecreto(req.headers.get('x-admin-secret') || '', adminSecret)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const { error: e1 } = await supabaseAdmin.from('mensajes').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  const { error: e2 } = await supabaseAdmin.from('ventas').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  const { error: e3 } = await supabaseAdmin.from('conversaciones').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  const { error: e4 } = await supabaseAdmin.from('clientes').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  const errores = [e1, e2, e3, e4].filter(Boolean).map((e) => e?.message);
  await auditarRequest(req, 'datos.borrar_todo', null, null, { errores });

  return NextResponse.json({
    ok: errores.length === 0,
    borrado: { mensajes: !e1, ventas: !e2, conversaciones: !e3, clientes: !e4 },
    errores: errores.length ? errores : undefined,
  });
}
