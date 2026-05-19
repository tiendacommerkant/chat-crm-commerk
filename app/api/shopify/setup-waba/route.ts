import { NextResponse } from 'next/server';

// GET /api/shopify/setup-waba
// Suscribe el WABA al webhook de la app — ejecutar una sola vez
export async function GET(req: Request) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const wabaId = new URL(req.url).searchParams.get('waba_id');

  if (!token) return NextResponse.json({ error: 'WHATSAPP_ACCESS_TOKEN no configurado' }, { status: 500 });
  if (!wabaId) return NextResponse.json({ error: 'Falta parámetro waba_id en la URL' }, { status: 400 });

  try {
    const res = await fetch(
      `https://graph.facebook.com/v20.0/${wabaId}/subscribed_apps`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );
    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json({ success: false, error: data }, { status: res.status });
    }

    return NextResponse.json({ success: true, data, mensaje: '✅ WABA suscrito correctamente al webhook de la app' });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
