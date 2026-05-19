import { NextResponse } from 'next/server';

// GET /api/shopify/setup-waba
// Diagnostica y suscribe el WABA al webhook de la app
export async function GET() {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token) return NextResponse.json({ error: 'WHATSAPP_ACCESS_TOKEN no configurado en Vercel' }, { status: 500 });
  if (!phoneNumberId) return NextResponse.json({ error: 'WHATSAPP_PHONE_NUMBER_ID no configurado en Vercel' }, { status: 500 });

  try {
    // 1. Obtener el WABA ID a partir del Phone Number ID
    const phoneRes = await fetch(
      `https://graph.facebook.com/v20.0/${phoneNumberId}?fields=id,display_phone_number,whatsapp_business_account`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const phoneData = await phoneRes.json();

    if (!phoneRes.ok || !phoneData.whatsapp_business_account?.id) {
      return NextResponse.json({
        paso: '1_obtener_waba',
        success: false,
        phone_number_id_usado: phoneNumberId,
        error: phoneData,
        ayuda: 'El token no tiene acceso a ese Phone Number ID, o el ID es incorrecto.',
      }, { status: 400 });
    }

    const wabaId = phoneData.whatsapp_business_account.id;

    // 2. Suscribir el WABA al webhook de la app
    const subRes = await fetch(
      `https://graph.facebook.com/v20.0/${wabaId}/subscribed_apps`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );
    const subData = await subRes.json();

    return NextResponse.json({
      success: subRes.ok,
      paso: '2_suscribir_waba',
      waba_id: wabaId,
      numero: phoneData.display_phone_number,
      resultado: subData,
      mensaje: subRes.ok
        ? '✅ WABA suscrito correctamente — los mensajes reales ahora llegarán al webhook'
        : '❌ Error al suscribir — revisa permisos del token',
    });

  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
