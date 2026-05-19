import { NextResponse } from 'next/server';

// GET /api/shopify/setup-waba?waba_id=XXXXXXX
// Suscribe el WABA al webhook de la app — ejecutar una sola vez
export async function GET(req: Request) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const wabaId = new URL(req.url).searchParams.get('waba_id') || '1014548717684753';

  if (!token) return NextResponse.json({ error: 'WHATSAPP_ACCESS_TOKEN no configurado en Vercel' }, { status: 500 });

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

    return NextResponse.json({
      success: res.ok && data.success === true,
      waba_id: wabaId,
      resultado: data,
      mensaje: res.ok && data.success
        ? '✅ WABA suscrito — los mensajes reales ahora llegarán al webhook'
        : '❌ Error al suscribir — revisa permisos del token',
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
