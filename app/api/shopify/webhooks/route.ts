// GET  /api/shopify/webhooks  → lista webhooks registrados en Shopify
// POST /api/shopify/webhooks  → registra/actualiza todos los webhooks necesarios
import { NextResponse } from 'next/server';
import { registrarWebhooksShopify, listarWebhooksShopify } from '@/lib/shopify';

export const dynamic = 'force-dynamic';

// La protección la hace el middleware (sesión del CRM). Antes se pedía
// CRON_SECRET, que el navegador no tiene: el botón del dashboard daba 401.

export async function GET() {
  try {
    const webhooks = await listarWebhooksShopify();
    return NextResponse.json({ success: true, total: webhooks.length, webhooks });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST() {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
    if (!baseUrl) {
      return NextResponse.json({ success: false, error: 'NEXT_PUBLIC_BASE_URL no configurado en Vercel' }, { status: 500 });
    }
    const resultados = await registrarWebhooksShopify(baseUrl);
    const exitosos = resultados.filter((r) => r.success).length;
    const fallidos = resultados.filter((r) => !r.success);
    return NextResponse.json({
      success: fallidos.length === 0,
      registrados: exitosos,
      total: resultados.length,
      detalle: resultados,
      webhook_url: `${baseUrl}/api/webhook/shopify`,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
