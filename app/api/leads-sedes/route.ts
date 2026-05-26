// GET /api/leads-sedes — Estadísticas de leads mayoristas por sede
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('leads_sedes')
      .select('sede, created_at')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const leads = data || [];

    // Contar por sede
    const porSede: Record<string, { total: number; ultimoLead: string | null }> = {};
    for (const lead of leads) {
      if (!porSede[lead.sede]) {
        porSede[lead.sede] = { total: 0, ultimoLead: null };
      }
      porSede[lead.sede].total += 1;
      if (!porSede[lead.sede].ultimoLead) {
        porSede[lead.sede].ultimoLead = lead.created_at;
      }
    }

    const estadisticas = Object.entries(porSede).map(([sede, datos]) => ({
      sede,
      total: datos.total,
      ultimo_lead: datos.ultimoLead,
    })).sort((a, b) => b.total - a.total);

    return NextResponse.json({
      success: true,
      total_leads: leads.length,
      por_sede: estadisticas,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
