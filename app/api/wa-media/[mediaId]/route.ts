// GET /api/wa-media/[mediaId] — Proxy seguro para media de WhatsApp
// WhatsApp requiere Authorization header para descargar media; el browser no puede hacerlo directamente
import { NextResponse } from 'next/server';

const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN!;
const WHATSAPP_API_URL = 'https://graph.facebook.com/v18.0';

export async function GET(req: Request, { params }: { params: { mediaId: string } }) {
  try {
    const { mediaId } = params;

    // 1. Obtener la URL del media desde WhatsApp
    const metaRes = await fetch(`${WHATSAPP_API_URL}/${mediaId}`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });

    if (!metaRes.ok) {
      return NextResponse.json({ error: 'Media no encontrado' }, { status: 404 });
    }

    const meta = await metaRes.json();
    const mediaUrl: string = meta.url;
    const mimeType: string = meta.mime_type || 'application/octet-stream';

    // 2. Descargar el archivo
    const fileRes = await fetch(mediaUrl, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });

    if (!fileRes.ok) {
      return NextResponse.json({ error: 'Error descargando media' }, { status: 502 });
    }

    const buffer = await fileRes.arrayBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
