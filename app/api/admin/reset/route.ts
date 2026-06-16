import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-admin-secret');
  if (secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const { data: mensajes, error: e1 } = await supabaseAdmin.from('mensajes').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  const { data: ventas,   error: e2 } = await supabaseAdmin.from('ventas').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  const { data: convs,    error: e3 } = await supabaseAdmin.from('conversaciones').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  const { data: clientes, error: e4 } = await supabaseAdmin.from('clientes').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  const errores = [e1, e2, e3, e4].filter(Boolean).map((e) => e?.message);

  return NextResponse.json({
    ok: errores.length === 0,
    borrado: {
      mensajes: (mensajes as any[])?.length ?? 'ok',
      ventas:   (ventas   as any[])?.length ?? 'ok',
      conversaciones: (convs as any[])?.length ?? 'ok',
      clientes: (clientes as any[])?.length ?? 'ok',
    },
    errores: errores.length ? errores : undefined,
  });
}
