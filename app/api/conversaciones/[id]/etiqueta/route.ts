import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { auditarRequest } from '@/lib/auditoria';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const { etiqueta } = await req.json();
    await supabaseAdmin
      .from('conversaciones')
      .update({ etiqueta: etiqueta || null, updated_at: new Date().toISOString() })
      .eq('id', params.id);
    await auditarRequest(req, 'conversacion.etiqueta', 'conversacion', params.id, { etiqueta: etiqueta || null });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
