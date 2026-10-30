// ============================================
// SESIÓN DEL CRM — cookie firmada (HMAC-SHA256)
// ============================================
//
// Antes el login dejaba una cookie `commerk_auth=1` que cualquiera podía
// escribir a mano en su navegador, y las rutas /api/* no pedían nada: con
// eso se leían nombres, teléfonos y mensajes de los clientes. Ahora el
// servidor emite la cookie solo después de verificar el token de Supabase,
// la firma con un secreto que nunca sale del servidor y el middleware la
// comprueba en cada página y ruta de la API.
//
// Solo usa Web Crypto para funcionar igual en el middleware (Edge) y en las
// rutas de la API (Node).

export const COOKIE_SESION = 'commerk_sesion';
export const DURACION_SESION_S = 60 * 60 * 24 * 7; // 7 días

export interface SesionCRM {
  sub: string;     // id del usuario en Supabase Auth
  email: string;
  nombre?: string; // cómo aparece el asesor en el chat
  rol?: RolCRM;     // admin gestiona el equipo; asesor atiende; sede ve sus leads
  sede?: string;   // solo rol sede: la tienda cuyos leads mayoristas ve
  exp: number;     // segundos epoch
}

export type RolCRM = 'admin' | 'asesor' | 'sede';

// Una cuenta de sede solo entra a sus leads mayoristas: el middleware la
// saca de cualquier otra pantalla o ruta de la API.
export const RUTAS_SEDE = { pantalla: '/dashboard/mayoristas', api: ['/api/mayoristas', '/api/auth/sesion'] };

export function rutaPermitidaParaSede(pathname: string): boolean {
  if (pathname.startsWith('/api/')) return RUTAS_SEDE.api.some((r) => pathname === r || pathname.startsWith(`${r}/`));
  return pathname === RUTAS_SEDE.pantalla || pathname.startsWith(`${RUTAS_SEDE.pantalla}/`);
}

/** "mateo.arbelaez@commerk.com.co" → "Mateo Arbelaez" (si no tiene nombre configurado). */
export function nombreDesdeEmail(email: string): string {
  const local = (email || '').split('@')[0] || 'Asesor';
  return local.split(/[._-]+/).filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ') || 'Asesor';
}

/** Lee la sesión del CRM desde la cookie de una petición a la API. */
export async function sesionDeRequest(req: Request): Promise<SesionCRM | null> {
  const cookies = req.headers.get('cookie') || '';
  const par = cookies.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE_SESION}=`));
  return leerSesion(par ? decodeURIComponent(par.slice(COOKIE_SESION.length + 1)) : null);
}

/** Asesor que hace la acción (nombre y correo de la sesión). */
export async function asesorDeRequest(req: Request): Promise<{ email: string; nombre: string; rol: RolCRM; sede?: string } | null> {
  const s = await sesionDeRequest(req);
  if (!s) return null;
  // Sesiones abiertas antes de los roles: solo existían las cuentas de la dirección
  return { email: s.email, nombre: s.nombre || nombreDesdeEmail(s.email), rol: s.rol || 'admin', ...(s.sede && { sede: s.sede }) };
}

/**
 * Rol de una cuenta del CRM. Las cuentas anteriores a los roles (sin rol
 * guardado) son las de la dirección de Commerk: quedan como administradoras.
 */
export function rolDeUsuario(appMetadata: Record<string, any> | undefined | null): RolCRM {
  if (appMetadata?.rol === 'asesor') return 'asesor';
  if (appMetadata?.rol === 'sede') return 'sede';
  return 'admin';
}

// SESSION_SECRET si existe; si no, la service key de Supabase (secreta y ya
// configurada en Vercel). Cambiar cualquiera de las dos cierra todas las sesiones.
function secreto(): string {
  return process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_KEY || '';
}

function aBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function deBase64Url(texto: string): Uint8Array<ArrayBuffer> {
  const b64 = texto.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (texto.length % 4)) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function llave(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('commerk-sesion-crm|' + secreto()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

/** Crea el valor de la cookie para un usuario ya verificado. */
export async function crearSesion(usuario: { id: string; email: string; nombre?: string; rol?: RolCRM; sede?: string }): Promise<string> {
  if (!secreto()) throw new Error('Falta SESSION_SECRET o SUPABASE_SERVICE_KEY para firmar la sesión');
  const datos: SesionCRM = {
    sub: usuario.id,
    email: usuario.email,
    nombre: usuario.nombre || nombreDesdeEmail(usuario.email),
    rol: usuario.rol || 'asesor',
    ...(usuario.rol === 'sede' && usuario.sede && { sede: usuario.sede }),
    exp: Math.floor(Date.now() / 1000) + DURACION_SESION_S,
  };
  const carga = aBase64Url(new TextEncoder().encode(JSON.stringify(datos)));
  const firma = await crypto.subtle.sign('HMAC', await llave(), new TextEncoder().encode(carga));
  return `${carga}.${aBase64Url(new Uint8Array(firma))}`;
}

/** Devuelve la sesión si la cookie es auténtica y no ha vencido; si no, null. */
export async function leerSesion(valor: string | undefined | null): Promise<SesionCRM | null> {
  if (!valor || !secreto()) return null;
  const [carga, firma, sobra] = valor.split('.');
  if (!carga || !firma || sobra !== undefined) return null;
  try {
    // verify compara en tiempo constante
    const valida = await crypto.subtle.verify(
      'HMAC', await llave(), deBase64Url(firma), new TextEncoder().encode(carga)
    );
    if (!valida) return null;
    const datos = JSON.parse(new TextDecoder().decode(deBase64Url(carga))) as SesionCRM;
    if (!datos?.sub || typeof datos.exp !== 'number' || datos.exp * 1000 < Date.now()) return null;
    return datos;
  } catch {
    return null;
  }
}

/** Compara dos secretos sin filtrar por tiempo cuántos caracteres coinciden. */
export function mismoSecreto(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferencia === 0;
}
