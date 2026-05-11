'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { supabase } from '@/lib/supabase';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });

      if (authError) {
        setError('Correo o contraseña incorrectos. Verifica tus datos.');
        return;
      }

      if (data.session) {
        // Cookie simple para que el middleware pueda redirigir
        document.cookie = 'commerk_auth=1; path=/; max-age=' + 60 * 60 * 24 * 7;
        router.replace('/dashboard');
      }
    } catch {
      setError('Error de conexión. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden">

      {/* Fondo: foto real */}
      <div className="absolute inset-0">
        <Image
          src="/DSC01664.jpg"
          alt="Tienda Commerk"
          fill
          className="object-cover object-center"
          priority
          quality={90}
        />
        {/* Overlay oscuro gradiente */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#0a1628]/85 via-[#0d1f3c]/75 to-[#0a1628]/90" />
      </div>

      {/* Partículas decorativas */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#25D366]/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-[#1a3a6b]/30 rounded-full blur-3xl" />
      </div>

      {/* Card de login */}
      <div className="relative z-10 w-full max-w-md px-6">
        <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl shadow-2xl shadow-black/40 p-10">

          {/* Logo */}
          <div className="flex flex-col items-center mb-8">
            <div className="relative w-48 h-16 mb-5">
              <Image
                src="/logos_logo_blanco.png"
                alt="Commerk"
                fill
                className="object-contain"
                priority
              />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">
              Bienvenido de vuelta
            </h1>
            <p className="text-sm text-white/50 mt-1">
              Ingresa a tu panel de administración
            </p>
          </div>

          {/* Formulario */}
          <form onSubmit={handleLogin} className="space-y-5">

            {/* Email */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-white/60 uppercase tracking-widest">
                Correo electrónico
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <svg className="w-4 h-4 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="admin@tiendacommerkant.com.co"
                  className="w-full pl-11 pr-4 py-3.5 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/30 text-sm focus:outline-none focus:border-[#25D366]/60 focus:bg-white/15 transition-all"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-white/60 uppercase tracking-widest">
                Contraseña
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <svg className="w-4 h-4 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••••••"
                  className="w-full pl-11 pr-12 py-3.5 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/30 text-sm focus:outline-none focus:border-[#25D366]/60 focus:bg-white/15 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-4 flex items-center text-white/40 hover:text-white/70 transition-colors"
                >
                  {showPassword ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2.5 px-4 py-3 bg-red-500/15 border border-red-500/30 rounded-xl">
                <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-red-300">{error}</p>
              </div>
            )}

            {/* Botón */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 bg-[#25D366] hover:bg-[#20bd5a] active:scale-[0.98] text-[#0d1f3c] font-bold text-sm rounded-xl transition-all shadow-lg shadow-[#25D366]/25 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-[#0d1f3c]/30 border-t-[#0d1f3c] rounded-full animate-spin" />
                  Verificando...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                  </svg>
                  Ingresar al CRM
                </>
              )}
            </button>
          </form>

          {/* Divisor */}
          <div className="mt-8 pt-6 border-t border-white/10 flex items-center justify-center gap-2">
            <div className="w-2 h-2 bg-[#25D366] rounded-full animate-pulse" />
            <p className="text-xs text-white/35">Sistema activo 24/7</p>
          </div>
        </div>

        {/* Copyright */}
        <p className="text-center text-xs text-white/25 mt-6">
          © {new Date().getFullYear()} Tienda Commerk Antioquia · Todos los derechos reservados
        </p>
      </div>
    </div>
  );
}
