'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

const navItems = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    href: '/dashboard/clientes',
    label: 'Clientes',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    href: '/dashboard/conversaciones',
    label: 'Conversaciones',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    ),
  },
  {
    href: '/dashboard/ventas',
    label: 'Ventas',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
      </svg>
    ),
  },
  {
    href: '/dashboard/pedidos',
    label: 'Pedidos',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    href: '/dashboard/productos',
    label: 'Productos',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" />
      </svg>
    ),
  },
  {
    href: '/dashboard/carritos',
    label: 'Carritos',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
  },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Verificar sesión activa y obtener email del usuario
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.replace('/login');
      } else {
        setUserEmail(session.user.email ?? null);
        setAuthChecked(true);
      }
    });
  }, [router]);

  // Cron: verificar y enviar recuperaciones de carritos cada 60s
  useEffect(() => {
    const run = () => fetch('/api/cron/recuperar-carritos', { method: 'POST' }).catch(() => {});
    run();
    const interval = setInterval(run, 60_000);
    return () => clearInterval(interval);
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    document.cookie = 'commerk_auth=; path=/; max-age=0';
    router.replace('/login');
  }

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-commerk-navy flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-commerk-green/20 border-t-commerk-green rounded-full animate-spin" />
          <p className="text-sm text-slate-400">Verificando sesión...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-commerk-navy text-white flex flex-col shrink-0">

        {/* Logo real */}
        <div className="px-6 py-5 border-b border-white/10">
          <div className="relative w-36 h-10">
            <Image
              src="/logos_logo_blanco.png"
              alt="Commerk"
              fill
              className="object-contain object-left"
              priority
            />
          </div>
          <p className="text-xs text-slate-500 mt-1.5 pl-0.5">CRM & Chatbot</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const isActive = item.href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
                  isActive
                    ? 'bg-commerk-green text-commerk-navy-dark shadow-sm shadow-commerk-green/30'
                    : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Footer sidebar: usuario + logout */}
        <div className="p-4 border-t border-white/10 space-y-1">
          {/* Usuario activo */}
          {userEmail && (
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/5 mb-2">
              <div className="w-7 h-7 rounded-full bg-commerk-green/20 border border-commerk-green/30 flex items-center justify-center shrink-0">
                <span className="text-xs font-bold text-commerk-green">
                  {userEmail[0].toUpperCase()}
                </span>
              </div>
              <p className="text-xs text-slate-300 truncate">{userEmail}</p>
            </div>
          )}

          {/* Botón cerrar sesión */}
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Cerrar sesión
          </button>

          <p className="text-xs text-slate-600 px-3 pt-1">tiendacommerkant.com.co</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto min-h-0">
        {children}
      </main>
    </div>
  );
}
