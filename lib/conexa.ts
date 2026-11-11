// ============================================
// CONEXA — la app de Wompi en Shopify
// ============================================
// Wompi manda sus eventos a UNA sola URL: la del CRM (/api/webhook/wompi). La
// app de Wompi en Shopify (Conexa) también los necesita: con ellos da por
// pagado el checkout de la tienda web y Shopify crea el pedido. Por eso el CRM
// se los reenvía.
//
// Antes el reenvío salía sin esperar la respuesta y Vercel podía cortarlo al
// responderle a Wompi: el 10 nov 2026 Kevin Giraldo pagó $50.700 en la tienda,
// Wompi lo aprobó y el pedido nunca apareció en Shopify. Ahora se espera la
// respuesta, se reintenta y, si no llega, se le pide a Wompi que reenvíe.

export const CONEXA_FORWARD_URL = 'https://wompi-event-shopify.conexa.ai/api/v1/shopify/webhooks/event';

export interface ResultadoReenvio {
  ok: boolean;
  status: number | null;
  intentos: number;
  error: string | null;
}

export async function reenviarAConexa(
  cuerpo: string,
  { intentos = 2, timeoutMs = 7000, esperaMs = 800 }: { intentos?: number; timeoutMs?: number; esperaMs?: number } = {}
): Promise<ResultadoReenvio> {
  let ultimo: ResultadoReenvio = { ok: false, status: null, intentos: 0, error: 'no se intentó' };
  for (let i = 1; i <= intentos; i++) {
    try {
      const r = await fetch(CONEXA_FORWARD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: cuerpo,
        signal: AbortSignal.timeout(timeoutMs),
        cache: 'no-store',
      });
      if (r.ok) return { ok: true, status: r.status, intentos: i, error: null };
      const texto = await r.text().catch(() => '');
      ultimo = { ok: false, status: r.status, intentos: i, error: `HTTP ${r.status}${texto ? `: ${texto.slice(0, 200)}` : ''}` };
      // Un rechazo (4xx, salvo 408/429) no cambia reenviando el mismo evento
      if (r.status < 500 && r.status !== 408 && r.status !== 429) break;
    } catch (e: any) {
      const sinRespuesta = e?.name === 'TimeoutError' || e?.name === 'AbortError';
      ultimo = { ok: false, status: null, intentos: i, error: sinRespuesta ? `sin respuesta en ${timeoutMs / 1000} s` : e?.message || String(e) };
    }
    if (i < intentos) await new Promise((listo) => setTimeout(listo, esperaMs * i));
  }
  return ultimo;
}
