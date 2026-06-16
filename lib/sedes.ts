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

// Texto del menú de sedes (1..6) para reutilizar en mensajes
export const MENU_SEDES =
  `*1.* 🏬 CC Tesoro\n` +
  `*2.* 🏬 CC Fabricato\n` +
  `*3.* 🏬 Autopista Sur - Itagüí\n` +
  `*4.* 🏬 Gran Manzana - Itagüí\n` +
  `*5.* 🏬 Mall Indiana\n` +
  `*6.* 🏬 Urabá - Apartadó`;
