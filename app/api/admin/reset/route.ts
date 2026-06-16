import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-admin-secret');
  if (secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const { error: e1 } = await supabaseAdmin.from('mensajes').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  const { error: e2 } = await supabaseAdmin.from('ventas').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  const { error: e3 } = await supabaseAdmin.from('conversaciones').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  const { error: e4 } = await supabaseAdmin.from('clientes').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  const errores = [e1, e2, e3, e4].filter(Boolean).map((e) => e?.message);

  return NextResponse.json({
    ok: errores.length === 0,
    borrado: { mensajes: !e1, ventas: !e2, conversaciones: !e3, clientes: !e4 },
    errores: errores.length ? errores : undefined,
  });
}
