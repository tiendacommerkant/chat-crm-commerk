// GET  /api/plantillas          → lista plantillas de Meta WhatsApp
// POST /api/plantillas          → crea una nueva plantilla
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const GRAPH_URL = 'https://graph.facebook.com/v20.0';
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN!;
const WABA_ID = process.env.WHATSAPP_WABA_ID || '1014548717684753';

export async function GET() {
  try {
    const res = await fetch(
      `${GRAPH_URL}/${WABA_ID}/message_templates?limit=100&fields=id,name,status,category,language,components,rejected_reason`,
      { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
    );
    const data = await res.json();
    if (!res.ok) return NextResponse.json({ success: false, error: data.error?.message }, { status: res.status });
    return NextResponse.json({ success: true, plantillas: data.data || [], total: data.data?.length || 0 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, category, language, components } = body;
    if (!name || !category || !language || !components) {
      return NextResponse.json({ success: false, error: 'Faltan campos requeridos' }, { status: 400 });
    }
    const res = await fetch(`${GRAPH_URL}/${WABA_ID}/message_templates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, category, language, components }),
    });
    const data = await res.json();
    if (!res.ok) return NextResponse.json({ success: false, error: data.error?.message }, { status: res.status });
    return NextResponse.json({ success: true, plantilla: data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
