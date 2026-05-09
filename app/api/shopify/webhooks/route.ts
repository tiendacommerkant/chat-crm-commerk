// GET  /api/shopify/webhooks → Lista webhooks registrados
// POST /api/shopify/webhooks → Registra todos los webhooks necesarios
import { NextResponse } from 'next/server';
import { registrarWebhooksShopify, listarWebhooksShopify } from '@/lib/shopify';

export async function GET() {
  try {
    const webhooks = await listarWebhooksShopify();
    return NextResponse.json({ success: true, webhooks });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
    if (!baseUrl) {
      return NextResponse.json(
        { success: false, error: 'NEXT_PUBLIC_BASE_URL no configurada en .env.local' },
        { status: 400 }
      );
    }

    const resultados = await registrarWebhooksShopify(baseUrl);
    const exitosos = resultados.filter((r) => r.success).length;
    const fallidos = resultados.filter((r) => !r.success);

    return NextResponse.json({ success: true, registrados: exitosos, total: resultados.length, detalle: resultados, fallidos });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
