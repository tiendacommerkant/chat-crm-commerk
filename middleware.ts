import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { COOKIE_SESION, leerSesion, mismoSecreto } from '@/lib/sesion';

// Rutas de la API que llaman servicios externos (Meta, Wompi, Shopify): cada
// una verifica su propia firma. El resto de la API exige sesión del CRM.
const API_PUBLICAS = ['/api/webhook/', '/api/auth/sesion'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sesion = await leerSesion(request.cookies.get(COOKIE_SESION)?.value);

  if (pathname.startsWith('/api/')) {
    if (API_PUBLICAS.some((p) => pathname.startsWith(p))) {
      return NextResponse.next();
    }
    // Tareas programadas (Vercel Cron / pg_cron) entran con CRON_SECRET
    if (pathname.startsWith('/api/cron/')) {
      const cron = process.env.CRON_SECRET || '';
      if (cron && mismoSecreto(request.headers.get('authorization') || '', `Bearer ${cron}`)) {
        return NextResponse.next();
      }
    }
    if (!sesion) {
      return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });
    }
    return NextResponse.next();
  }

  // Proteger todas las rutas del dashboard
  if (pathname.startsWith('/dashboard') && !sesion) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Si ya está autenticado y va al login, redirigir al dashboard
  if (pathname === '/login' && sesion) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/login', '/api/:path*'],
};
