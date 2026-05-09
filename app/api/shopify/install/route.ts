import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// GET /api/shopify/install
// Maneja tanto el inicio del OAuth como el Callback de Shopify
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const shop = url.searchParams.get('shop') || process.env.SHOPIFY_STORE + '.myshopify.com';
    const code = url.searchParams.get('code');
    
    const clientId = process.env.SHOPIFY_CLIENT_ID;
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
    const redirectUri = `${process.env.NEXT_PUBLIC_BASE_URL}/api/shopify/install`;

    if (!clientId || !clientSecret) {
      return new NextResponse(`
        <h1>Faltan credenciales</h1>
        <p>Agrega SHOPIFY_CLIENT_ID y SHOPIFY_CLIENT_SECRET a tu archivo .env.local</p>
      `, { headers: { 'Content-Type': 'text/html' } });
    }

    // Si NO hay código, iniciamos el flujo redirigiendo a Shopify
    if (!code) {
      const scopes = 'read_products,read_inventory';
      const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${redirectUri}`;
      return NextResponse.redirect(installUrl);
    }

    // Si HAY código, hacemos el intercambio por el Token de Acceso
    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      return NextResponse.json({ error: 'Fallo al obtener el token', details: tokenData });
    }

    // Mostrar el token en pantalla para que el usuario lo copie
    const htmlResponse = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 40px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
        <h1 style="color: #1B3A6B;">✅ ¡Instalación Exitosa!</h1>
        <p>Aquí tienes tu Token de Acceso para la API de Shopify. Cópialo y pégalo en tu archivo <strong>.env.local</strong> como <strong>SHOPIFY_ACCESS_TOKEN</strong>:</p>
        <div style="background: #f4f4f4; padding: 15px; border-radius: 4px; border: 1px solid #ccc; font-family: monospace; font-size: 16px; word-break: break-all;">
          ${tokenData.access_token}
        </div>
        <p style="margin-top: 20px; color: #666; font-size: 14px;">(Puedes cerrar esta pestaña una vez lo hayas copiado)</p>
      </div>
    `;

    return new NextResponse(htmlResponse, { headers: { 'Content-Type': 'text/html' } });

  } catch (error: any) {
    console.error('Error en OAuth Shopify:', error);
    return new NextResponse(`<h1>Error</h1><p>${error.message}</p>`, { headers: { 'Content-Type': 'text/html' }, status: 500 });
  }
}
