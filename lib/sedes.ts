// ============================================
// SEDES FÍSICAS — fuente única de verdad
// Usado por el bot (recoger en tienda / mayorista) y el webhook de pago
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
};

// Sedes para compras al por mayor (incluye Parque comercial Florida)
export const SEDES_MAYORISTA: Record<string, Sede> = {
  ...SEDES_FISICAS,
  '7': { nombre: 'Parque Comercial Florida', telefono: '573153658482' },
};

export const MENU_SEDES_MAYORISTA =
  `*1.* 🏬 CC Tesoro\n` +
  `*2.* 🏬 CC Fabricato\n` +
  `*3.* 🏬 Autopista Sur - Itagüí\n` +
  `*4.* 🏬 Gran Manzana - Itagüí\n` +
  `*5.* 🏬 Mall Indiana\n` +
  `*6.* 🏬 Urabá - Apartadó\n` +
  `*7.* 🏬 Parque Comercial Florida`;

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
  const sede = Object.values(SEDES_MAYORISTA).find((s) => s.nombre === nombreSede);
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
 * Encuentra una sede por número ("3") o por nombre hablado ("el del Tesoro").
 * Devuelve null si el texto no identifica una sede sin ambigüedad.
 */
export function encontrarSede(texto: string, mapa: Record<string, Sede> = SEDES_FISICAS): Sede | null {
  const limpio = texto.trim();

  // Por número
  const soloNumero = limpio.match(/^(\d+)$/);
  if (soloNumero && mapa[soloNumero[1]]) return mapa[soloNumero[1]];

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

// Texto del menú de sedes (1..6) para reutilizar en mensajes
export const MENU_SEDES =
  `*1.* 🏬 CC Tesoro\n` +
  `*2.* 🏬 CC Fabricato\n` +
  `*3.* 🏬 Autopista Sur - Itagüí\n` +
  `*4.* 🏬 Gran Manzana - Itagüí\n` +
  `*5.* 🏬 Mall Indiana\n` +
  `*6.* 🏬 Urabá - Apartadó`;
