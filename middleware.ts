import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Proteger todas las rutas del dashboard
  if (pathname.startsWith('/dashboard')) {
    const auth = request.cookies.get('commerk_auth');
    if (!auth) {
      const loginUrl = new URL('/login', request.url);
      return NextResponse.redirect(loginUrl);
    }
  }

  // Si ya está autenticado y va al login, redirigir al dashboard
  if (pathname === '/login') {
    const auth = request.cookies.get('commerk_auth');
    if (auth) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/login'],
};
