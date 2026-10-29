// GET /api/usuarios — Asesores con acceso al CRM (para asignar conversaciones)
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { asesorDeRequest, nombreDesdeEmail } from '@/lib/sesion';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const yo = await asesorDeRequest(req);
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    if (error) throw error;
    const usuarios = (data?.users || [])
      .filter((u) => u.app_metadata?.crm_acceso === true && u.email)
      .map((u) => ({
        email: u.email!,
        nombre: (u.user_metadata?.nombre as string) || nombreDesdeEmail(u.email!),
        rol: (u.app_metadata?.rol as string) || 'asesor',
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
    return NextResponse.json({ success: true, usuarios, yo });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
