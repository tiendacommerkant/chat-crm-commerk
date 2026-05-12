// PATCH /api/conversaciones/[id]/bot-toggle — Activar/desactivar bot para una conversación
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const { bot_activo } = await req.json();

    if (typeof bot_activo !== 'boolean') {
      return NextResponse.json({ success: false, error: 'bot_activo debe ser boolean' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('conversaciones')
      .update({ bot_activo, updated_at: new Date().toISOString() })
      .eq('id', params.id)
      .select('id, bot_activo')
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, bot_activo: data.bot_activo });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
