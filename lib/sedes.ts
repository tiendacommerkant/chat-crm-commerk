// ============================================
// SEDES FÍSICAS — fuente única de verdad
// Usado por el bot (registro / recoger en tienda / mayorista) y el webhook de pago
// ============================================

export interface Sede {
  nombre: string;
  telefono: string;
}

export const SEDES_FISICAS: Record<string, Sede> = {
  '1': { nombre: 'CC Tesoro', telefono: '573156125533' },
  '2': { nombre: 'CC Fabricato', telefono: '573175402082' },
  '3': { nombre: 'Autopista Sur - Itagüí', telefono: '573183349171' },
  '4': { nombre: 'Gran Manzana - Itagüí', telefono: '573156125765' },
  '5': { nombre: 'Mall Indiana', telefono: '573185608348' },
  '6': { nombre: 'Urabá - Apartadó', telefono: '573160173928' },
  '7': { nombre: 'Parque Comercial Florida', telefono: '573153658482' },
};

// Prefijo que marca un pedido para recoger en tienda (se guarda en direccion_envio)
export const PREFIJO_RECOGIDA = 'Recoge en tienda: ';

export function esRecogidaEnTienda(direccion?: string | null): boolean {
  return !!direccion && direccion.startsWith(PREFIJO_RECOGIDA);
}

export function nombreSedeDesdeDireccion(direccion?: string | null): string | null {
  if (!esRecogidaEnTienda(direccion)) return null;
  return direccion!.slice(PREFIJO_RECOGIDA.length).trim();
}

export function buscarTelefonoSede(nombreSede: string): string | null {
  const sede = Object.values(SEDES_FISICAS).find((s) => s.nombre === nombreSede);
  return sede?.telefono ?? null;
}

// Palabras que identifican cada sede (para elegirla hablando, no solo por número)
const ALIAS_SEDES: Record<string, string[]> = {
  'CC Tesoro': ['tesoro'],
  'CC Fabricato': ['fabricato'],
  'Autopista Sur - Itagüí': ['autopista', 'autopista sur'],
  'Gran Manzana - Itagüí': ['gran manzana', 'manzana'],
  'Mall Indiana': ['indiana', 'mall indiana'],
  'Urabá - Apartadó': ['uraba', 'apartado', 'apartadó', 'urabá'],
  'Parque Comercial Florida': ['florida', 'parque comercial', 'parque'],
};

/**
 * Extrae el número de una respuesta tipo "elige una opción" tolerando la
 * puntuación con la que la gente suele responder listas en WhatsApp: "3.",
 * "3)", "(3)", "opción 3", " 3 ". Limitado a 1-2 dígitos para no confundir
 * con un número de teléfono u otro dato largo. Devuelve null si no aplica.
 */
export function extraerNumeroOpcion(texto: string): string | null {
  const m = texto.trim().match(/^[(\[]?\s*(\d{1,2})\s*[).\]]?$/);
  return m ? m[1] : null;
}

/**
 * Encuentra una sede por número ("3", "3.", "(3)") o por nombre hablado
 * ("el del Tesoro"). Devuelve null si el texto no identifica una sede sin
 * ambigüedad.
 */
export function encontrarSede(texto: string, mapa: Record<string, Sede> = SEDES_FISICAS): Sede | null {
  const limpio = texto.trim();

  // Por número (tolera "3.", "3)", etc. — no solo el dígito pelado)
  const numero = extraerNumeroOpcion(limpio);
  if (numero && mapa[numero]) return mapa[numero];

  // Por nombre
  const t = limpio.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const disponibles = Object.values(mapa);
  for (const sede of disponibles) {
    const alias = ALIAS_SEDES[sede.nombre] || [];
    for (const a of alias) {
      const clave = a.normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (new RegExp(`(^|\\W)${clave}(\\W|$)`).test(t)) return sede;
    }
  }
  return null;
}

// Menú de sedes (recoger en tienda y compras al por mayor). Se arma desde
// SEDES_FISICAS para que agregar una sede nunca deje los textos desfasados.
export const MENU_SEDES = Object.entries(SEDES_FISICAS)
  .map(([n, s]) => `*${n}.* 🏬 ${s.nombre}`)
  .join('\n');

// Menú del registro inicial: la opción 1 es Virtual y las tiendas van desde la 2.
export const MENU_SEDES_REGISTRO =
  `*1.* 🌐 Virtual (envío a domicilio)\n` +
  Object.entries(SEDES_FISICAS)
    .map(([n, s]) => `*${Number(n) + 1}.* 🏬 ${s.nombre}`)
    .join('\n');

// Traduce el número elegido en el registro inicial al nombre de sede.
export function sedeDeRegistroPorNumero(numero: string): string | undefined {
  if (numero === '1') return 'Virtual';
  return SEDES_FISICAS[String(Number(numero) - 1)]?.nombre;
}
