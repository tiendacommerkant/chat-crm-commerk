// GET /api/carritos → Lista carritos abandonados con filtros opcionales
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const estado = searchParams.get('estado');
    const limite = parseInt(searchParams.get('limit') || '200');

    const ahora = new Date().toISOString();
    const corte20min = new Date(Date.now() - 20 * 60 * 1000).toISOString();

    // Marcar como 'abandonado' los en_progreso sin actividad > 20 min
    await supabaseAdmin
      .from('carritos_abandonados')
      .update({ estado: 'abandonado', updated_at: ahora })
      .eq('estado', 'en_progreso')
      .lt('shopify_updated_at', corte20min);

    // Reactivar a 'en_progreso' los abandonados que volvieron a tener actividad reciente
    await supabaseAdmin
      .from('carritos_abandonados')
      .update({ estado: 'en_progreso', updated_at: ahora })
      .eq('estado', 'abandonado')
      .eq('notificado_whatsapp', false)
      .gte('shopify_updated_at', corte20min);

    let query = supabaseAdmin
      .from('carritos_abandonados')
      .select('*')
      .order('shopify_updated_at', { ascending: false })
      .limit(limite);

    if (estado) query = query.eq('estado', estado);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ success: true, carritos: data || [] });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
