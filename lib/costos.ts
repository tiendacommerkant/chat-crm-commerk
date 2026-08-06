// ============================================
// COSTOS — Registro de consumo real (Claude + WhatsApp)
// ============================================
// Cada llamada a la IA y cada plantilla enviada quedan registradas con su
// costo, para poder verlo en el panel sin depender de facturas externas.

import { supabaseAdmin } from './supabase';

// ── Tarifas Claude (USD por millón de tokens) ─────────────────────
// Fuente: platform.claude.com/docs/en/about-claude/pricing
export const TARIFAS_CLAUDE: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-opus-5':   { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-4-5':{ input: 1, output: 5,  cacheRead: 0.1, cacheWrite: 1.25 },
};

// ── Tarifas WhatsApp Colombia (USD por mensaje entregado) ─────────
// Ajustables por si Meta cambia precios, sin tocar código.
export const TARIFA_WA_MARKETING = parseFloat(process.env.WA_TARIFA_MARKETING || '0.0125');
export const TARIFA_WA_UTILITY   = parseFloat(process.env.WA_TARIFA_UTILITY   || '0.0012');

// Categoría real de cada plantilla en Meta (marketing cuesta ~10x más)
export const CATEGORIA_PLANTILLA: Record<string, 'marketing' | 'utility'> = {
  recordatorio_pago:   'marketing',
  carrito_abandonado:  'marketing',
  lead_mayorista:      'marketing',
  confirmacion_pago:   'utility',
  pedido_en_camino:    'utility',
  pedido_recoger_sede: 'utility',
};

export const USD_A_COP = parseFloat(process.env.USD_COP || '4000');

export interface UsoClaude {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export function calcularCostoClaude(modelo: string, uso: UsoClaude): number {
  const t = TARIFAS_CLAUDE[modelo] || TARIFAS_CLAUDE['claude-opus-5'];
  const M = 1_000_000;
  return (
    ((uso.input_tokens || 0) * t.input +
      (uso.output_tokens || 0) * t.output +
      (uso.cache_read_input_tokens || 0) * t.cacheRead +
      (uso.cache_creation_input_tokens || 0) * t.cacheWrite) / M
  );
}

/** Registra el consumo de una llamada a la IA. Nunca rompe el flujo del bot. */
export async function registrarUsoClaude(modelo: string, uso: UsoClaude): Promise<void> {
  try {
    await supabaseAdmin.from('uso_costos').insert({
      tipo: 'claude',
      detalle: modelo,
      input_tokens: uso.input_tokens || 0,
      output_tokens: uso.output_tokens || 0,
      cache_read_tokens: uso.cache_read_input_tokens || 0,
      cache_write_tokens: uso.cache_creation_input_tokens || 0,
      costo_usd: calcularCostoClaude(modelo, uso),
    });
  } catch (e: any) {
    console.error('[Costos] No se registró uso de Claude:', e?.message);
  }
}

/** Registra el envío de una plantilla de WhatsApp. Nunca rompe el envío. */
export async function registrarEnvioPlantilla(plantilla: string, entregado: boolean): Promise<void> {
  try {
    const categoria = CATEGORIA_PLANTILLA[plantilla] || 'utility';
    const costo = entregado
      ? (categoria === 'marketing' ? TARIFA_WA_MARKETING : TARIFA_WA_UTILITY)
      : 0; // Meta solo cobra los mensajes entregados
    await supabaseAdmin.from('uso_costos').insert({
      tipo: 'whatsapp_template',
      detalle: plantilla,
      categoria,
      cantidad: 1,
      entregado,
      costo_usd: costo,
    });
  } catch (e: any) {
    console.error('[Costos] No se registró envío de plantilla:', e?.message);
  }
}
