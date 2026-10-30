// POST   /api/auth/sesion — Cambia el token de Supabase por la cookie de sesión del CRM
// DELETE /api/auth/sesion — Cierra la sesión
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { auditar } from '@/lib/auditoria';
import { COOKIE_SESION, DURACION_SESION_S, crearSesion, rolDeUsuario } from '@/lib/sesion';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { access_token } = await req.json().catch(() => ({}));
    if (!access_token || typeof access_token !== 'string') {
      return NextResponse.json({ success: false, error: 'Falta el token' }, { status: 400 });
    }

    // Supabase confirma que el token es real y vigente
    const { data, error } = await supabaseAdmin.auth.getUser(access_token);
    const usuario = data?.user;
    if (error || !usuario) {
      return NextResponse.json({ success: false, error: 'Sesión inválida' }, { status: 401 });
    }

    // Solo entran las cuentas habilitadas para el CRM. app_metadata solo lo
    // puede escribir el servidor, así que alguien que se registre por su
    // cuenta en Supabase no obtiene acceso.
    if (usuario.app_metadata?.crm_acceso !== true) {
      return NextResponse.json({ success: false, error: 'Este usuario no tiene acceso al CRM' }, { status: 403 });
    }

    const res = NextResponse.json({ success: true });
    await auditar({ email: usuario.email || '', nombre: (usuario.user_metadata?.nombre as string) || usuario.email || '' }, 'sesion.ingreso', 'usuario', usuario.id);
    const nombre = (usuario.user_metadata?.nombre as string | undefined) || undefined;
    const rol = rolDeUsuario(usuario.app_metadata);
    res.cookies.set(COOKIE_SESION, await crearSesion({ id: usuario.id, email: usuario.email || '', nombre, rol }), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: DURACION_SESION_S,
    });
    return res;
  } catch (error: any) {
    console.error('[Sesión] Error creando sesión:', error?.message);
    return NextResponse.json({ success: false, error: 'No se pudo iniciar sesión' }, { status: 500 });
  }
}

export async function DELETE() {
  const res = NextResponse.json({ success: true });
  res.cookies.set(COOKIE_SESION, '', { httpOnly: true, path: '/', maxAge: 0 });
  // Cookie del sistema anterior
  res.cookies.set('commerk_auth', '', { path: '/', maxAge: 0 });
  return res;
}
