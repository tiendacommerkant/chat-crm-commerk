// GET /api/costos?dias=30 → consumo real de Claude y plantillas de WhatsApp
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { USD_A_COP, CATEGORIA_PLANTILLA, TARIFA_WA_MARKETING, TARIFA_WA_UTILITY } from '@/lib/costos';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const dias = Math.min(parseInt(new URL(req.url).searchParams.get('dias') || '30'), 365);
  const desde = new Date(Date.now() - dias * 86400000).toISOString();

  const { data, error } = await supabaseAdmin
    .from('uso_costos')
    .select('tipo, detalle, categoria, cantidad, entregado, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, costo_usd, created_at')
    .gte('created_at', desde)
    .limit(20000);

  if (error) {
    // La tabla puede no existir todavía — el panel lo indica en vez de romperse
    return NextResponse.json({ success: false, error: error.message, tablaFaltante: true }, { status: 200 });
  }

  const filas = data || [];
  const claude = filas.filter((f) => f.tipo === 'claude');
  const plantillas = filas.filter((f) => f.tipo === 'whatsapp_template');

  const sum = (arr: any[], k: string) => arr.reduce((s, f) => s + Number(f[k] || 0), 0);

  // Detalle por plantilla
  const porPlantilla: Record<string, any> = {};
  for (const p of plantillas) {
    const k = p.detalle;
    if (!porPlantilla[k]) {
      porPlantilla[k] = {
        nombre: k,
        categoria: p.categoria || CATEGORIA_PLANTILLA[k] || 'utility',
        enviadas: 0,
        entregadas: 0,
        fallidas: 0,
        costo_usd: 0,
      };
    }
    porPlantilla[k].enviadas += 1;
    if (p.entregado) porPlantilla[k].entregadas += 1;
    else porPlantilla[k].fallidas += 1;
    porPlantilla[k].costo_usd += Number(p.costo_usd || 0);
  }

  const costoClaude = sum(claude, 'costo_usd');
  const costoWa = sum(plantillas, 'costo_usd');

  return NextResponse.json({
    success: true,
    dias,
    tarifas: {
      usd_cop: USD_A_COP,
      wa_marketing: TARIFA_WA_MARKETING,
      wa_utility: TARIFA_WA_UTILITY,
    },
    claude: {
      llamadas: claude.length,
      input_tokens: sum(claude, 'input_tokens'),
      output_tokens: sum(claude, 'output_tokens'),
      cache_read_tokens: sum(claude, 'cache_read_tokens'),
      cache_write_tokens: sum(claude, 'cache_write_tokens'),
      costo_usd: costoClaude,
      costo_cop: costoClaude * USD_A_COP,
      costo_por_conversacion_usd: claude.length ? costoClaude / claude.length : 0,
    },
    whatsapp: {
      enviadas: plantillas.length,
      entregadas: plantillas.filter((p) => p.entregado).length,
      costo_usd: costoWa,
      costo_cop: costoWa * USD_A_COP,
      plantillas: Object.values(porPlantilla).sort((a: any, b: any) => b.costo_usd - a.costo_usd),
    },
    total: {
      costo_usd: costoClaude + costoWa,
      costo_cop: (costoClaude + costoWa) * USD_A_COP,
    },
  });
}
