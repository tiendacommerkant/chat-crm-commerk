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
  sub: string;   // id del usuario en Supabase Auth
  email: string;
  exp: number;   // segundos epoch
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
export async function crearSesion(usuario: { id: string; email: string }): Promise<string> {
  if (!secreto()) throw new Error('Falta SESSION_SECRET o SUPABASE_SERVICE_KEY para firmar la sesión');
  const datos: SesionCRM = {
    sub: usuario.id,
    email: usuario.email,
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
