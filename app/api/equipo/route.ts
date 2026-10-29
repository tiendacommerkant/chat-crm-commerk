// GET   /api/equipo — Cuentas del CRM (solo administradores)
// POST  /api/equipo — Crea un asesor { email, nombre, password, rol }
// PATCH /api/equipo — Edita { id, nombre?, rol?, acceso? }
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { asesorDeRequest, nombreDesdeEmail, rolDeUsuario, type RolCRM } from '@/lib/sesion';

export const dynamic = 'force-dynamic';

async function soloAdmin(req: Request) {
  const yo = await asesorDeRequest(req);
  if (!yo) return { error: NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 }) };
  if (yo.rol !== 'admin') return { error: NextResponse.json({ success: false, error: 'Solo un administrador puede gestionar el equipo' }, { status: 403 }) };
  return { yo };
}

const rolValido = (r: unknown): RolCRM | null => (r === 'admin' || r === 'asesor' ? r : null);

export async function GET(req: Request) {
  const { error } = await soloAdmin(req);
  if (error) return error;
  const { data, error: e } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
  if (e) return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  const equipo = (data?.users || [])
    .filter((u) => u.email)
    .map((u) => ({
      id: u.id,
      email: u.email!,
      nombre: (u.user_metadata?.nombre as string) || nombreDesdeEmail(u.email!),
      rol: rolDeUsuario(u.app_metadata),
      acceso: u.app_metadata?.crm_acceso === true,
      ultimo_ingreso: u.last_sign_in_at || null,
      creado: u.created_at,
    }))
    .sort((a, b) => Number(b.acceso) - Number(a.acceso) || a.nombre.localeCompare(b.nombre));
  return NextResponse.json({ success: true, equipo });
}

export async function POST(req: Request) {
  const { error } = await soloAdmin(req);
  if (error) return error;
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const nombre = String(body.nombre || '').trim();
  const password = String(body.password || '');
  const rol = rolValido(body.rol) || 'asesor';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ success: false, error: 'Correo no válido' }, { status: 400 });
  if (!nombre) return NextResponse.json({ success: false, error: 'Escribe el nombre del asesor' }, { status: 400 });
  if (password.length < 10) return NextResponse.json({ success: false, error: 'La contraseña debe tener al menos 10 caracteres' }, { status: 400 });

  const { data, error: e } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { nombre },
    app_metadata: { crm_acceso: true, rol },
  });
  if (e) {
    const yaExiste = /already|registered|exists/i.test(e.message);
    return NextResponse.json({ success: false, error: yaExiste ? 'Ya existe una cuenta con ese correo' : e.message }, { status: 400 });
  }
  return NextResponse.json({ success: true, id: data.user?.id });
}

export async function PATCH(req: Request) {
  const { yo, error } = await soloAdmin(req);
  if (error) return error;
  const body = await req.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ success: false, error: 'Falta la cuenta' }, { status: 400 });

  const { data: actual, error: e1 } = await supabaseAdmin.auth.admin.getUserById(body.id);
  if (e1 || !actual?.user) return NextResponse.json({ success: false, error: 'Cuenta no encontrada' }, { status: 404 });
  const u = actual.user;

  // Nadie se quita a sí mismo el acceso ni el rol de administrador
  if (u.email === yo!.email && (body.acceso === false || body.rol === 'asesor')) {
    return NextResponse.json({ success: false, error: 'No puedes quitarte tu propio acceso ni tu rol de administrador' }, { status: 400 });
  }

  const app_metadata: Record<string, any> = { ...u.app_metadata };
  if (body.acceso !== undefined) app_metadata.crm_acceso = body.acceso === true;
  const rol = rolValido(body.rol);
  if (rol) app_metadata.rol = rol;
  const user_metadata: Record<string, any> = { ...u.user_metadata };
  if (typeof body.nombre === 'string' && body.nombre.trim()) user_metadata.nombre = body.nombre.trim();

  const { error: e2 } = await supabaseAdmin.auth.admin.updateUserById(body.id, { app_metadata, user_metadata });
  if (e2) return NextResponse.json({ success: false, error: e2.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
