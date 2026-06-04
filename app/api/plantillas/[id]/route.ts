// PUT    /api/plantillas/[id]  → actualiza componentes (Meta envía a revisión)
// DELETE /api/plantillas/[id]  → elimina la plantilla
import { NextResponse } from 'next/server';

const GRAPH_URL = 'https://graph.facebook.com/v20.0';
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN!;
const WABA_ID = process.env.WHATSAPP_WABA_ID || '1014548717684753';

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const { components } = await req.json();
    const res = await fetch(`${GRAPH_URL}/${params.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ components }),
    });
    const data = await res.json();
    if (!res.ok) return NextResponse.json({ success: false, error: data.error?.message }, { status: res.status });
    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const res = await fetch(
      `${GRAPH_URL}/${WABA_ID}/message_templates?hsm_id=${params.id}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
    );
    const data = await res.json();
    if (!res.ok) return NextResponse.json({ success: false, error: data.error?.message }, { status: res.status });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
