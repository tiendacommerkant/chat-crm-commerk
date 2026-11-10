// ============================================
// NOMBRE PARA SALUDAR
// ============================================
// El nombre de perfil de WhatsApp trae emojis, símbolos o correos ("🤍",
// "😘📖L-E-L-A🙏🏽", "millerfelipe975@gmail,Com", "A.P"). En la auditoría el
// bot saludaba "¡Con mucho gusto, 🤍!". Se limpia y, si no queda un nombre
// real, no se usa ninguno.

function capitalizar(s: string): string {
  if (s.length > 3 && s === s.toUpperCase()) return s[0] + s.slice(1).toLowerCase();
  return s[0].toUpperCase() + s.slice(1);
}

/** Primer nombre limpio, o null si el perfil no trae un nombre usable. */
export function primerNombre(nombre?: string | null): string | null {
  if (!nombre) return null;
  const limpio = nombre
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️]/gu, ' ')
    .replace(/[^\p{L}\s'-]/gu, ' ')
    .trim();
  const partes = limpio.split(/\s+/).filter(Boolean);
  // "Sra Marcela", "Don Luis": el nombre es la segunda palabra
  if (partes.length > 1 && /^(sr|sra|srta|don|dona|doña|dr|dra)\.?$/i.test(partes[0])) partes.shift();
  const primero = partes[0] || '';
  if (primero.replace(/[^\p{L}]/gu, '').length < 2) return null;
  return capitalizar(primero);
}
