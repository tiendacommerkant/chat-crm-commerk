// GET /api/clientes — Busca clientes con filtro opcional ?q= y ?limit=
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get('q') || '';
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50);

    let query = supabaseAdmin
      .from('clientes')
      .select('id, nombre, telefono, email, ciudad, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (q.trim()) {
      query = query.or(
        `nombre.ilike.%${q}%,telefono.ilike.%${q}%,email.ilike.%${q}%`
      );
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ success: true, clientes: data || [] });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
