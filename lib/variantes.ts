// ============================================================
// VARIANTES DE PRODUCTO ("Arma tu kit")
// ============================================================
// Los kits de Shopify tienen una variante por botella y cada una con su
// precio (Kit Decantador: $235.200 con Esencial, $313.400 con Gran Reserva).
// Antes solo se usaba la primera variante —la más cara— y el bot cobraba ese
// precio con cualquier botella, y el pedido en Shopify salía con esa botella.
// Utilidades puras (sin dependencias) para poder probarlas de forma aislada.

export interface Variante {
  id: string;
  titulo: string;
  precio: number;
  inventario: number;
}

interface ProductoConVariantes {
  shopify_id: string;
  titulo: string;
  metadata?: Record<string, any> | null;
}

// Separador entre el producto y la variante en el nombre de un ítem del
// carrito ("Kit Decantador — Carta de Oro"). Ese nombre es el que queda
// guardado en ventas, y de él se recupera la variante al crear el pedido.
export const SEPARADOR_VARIANTE = ' — ';

export function variantesDe(producto: ProductoConVariantes | null | undefined): Variante[] {
  const vs = producto?.metadata?.variantes;
  return Array.isArray(vs) ? vs : [];
}

export function varianteDe(producto: ProductoConVariantes | null | undefined, varianteId?: string | null): Variante | null {
  if (!varianteId) return null;
  return variantesDe(producto).find((v) => v.id === String(varianteId)) || null;
}

export function tituloConVariante(tituloProducto: string, variante?: Variante | null): string {
  return variante ? `${tituloProducto}${SEPARADOR_VARIANTE}${variante.titulo}` : tituloProducto;
}

// Una entrada de la cola de productos pendientes: "idProducto" o
// "idProducto|idVariante" cuando el cliente ya dijo qué botella quiere.
export function codificarPendiente(productoId: string, varianteId?: string | null): string {
  return varianteId ? `${productoId}|${varianteId}` : productoId;
}

export function decodificarPendiente(entrada: string): { productoId: string; varianteId: string | null } {
  const [productoId, varianteId] = String(entrada).split('|');
  return { productoId, varianteId: varianteId || null };
}

function normalizar(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/(\d)\s*ml\b/g, '$1 ml')
    .replace(/\s+/g, ' ')
    .trim();
}

// Cómo nombra la gente la botella o el tamaño → texto que aparece en el
// título de la variante. El orden importa: "litro y medio" antes que "litro".
const ALIAS_BOTELLA: Array<[RegExp, string]> = [
  [/\b(8|ocho) anos\b/, 'carta de oro'],
  [/\b(15|quince) anos\b|\bgre\b/, 'gran reserva'],
  [/\b(5|cinco) anos\b|\bjuan\b/, 'juan de la cruz'],
  [/\b(3|tres) anos\b/, 'tradicional'],
  [/\bblanco\b/, 'roble blanco'],
  [/\bcrema\b/, 'cheers'],
  [/\baguardiente\b/, 'amarillo'],
  [/\bgarrafas?\b|\b1500\b|litro y medio/, '1500'],
  [/\btetra ?pak\b|\btetra\b/, 'tetra pak'],
  [/\blitros?\b|\b1000\b/, '1000'],
  [/\bmedia\b|\b375\b/, '375'],
  [/\b750\b|\bbotella normal\b|\bbotella entera\b/, '750'],
];

// Palabras sueltas que no distinguen una variante ("el decantador especial"
// no es pedir la "Gran Reserva Especial").
const PALABRAS_VACIAS = new Set([
  'de', 'del', 'la', 'el', 'con', 'ml', 'cu', 'y', 'especial', 'edicion', 'botella', 'botellas',
  'kit', 'ron', 'viejo', 'caldas', 'manzanares', 'litros',
]);

/**
 * Identifica la variante que pide el cliente: por el nombre exacto ("Carta de
 * Oro", que es lo que devuelve Sofi), por pistas ("la de 8 años", "la media")
 * o, si `permitirNumero`, por el número del listado que se le mostró ("2").
 * Devuelve null si no hay pista o si sigue habiendo más de una candidata:
 * en ese caso se le pregunta al cliente en vez de adivinar.
 */
export function resolverVariante(
  producto: ProductoConVariantes,
  texto: string | null | undefined,
  { permitirNumero = false }: { permitirNumero?: boolean } = {}
): Variante | null {
  const vs = variantesDe(producto);
  if (vs.length === 0 || !texto?.trim()) return null;
  const t = normalizar(texto);

  if (permitirNumero) {
    const m = t.match(/^(?:la |el |opcion )?[(\[]?\s*(\d{1,2})\s*[).\]]?$/);
    if (m) {
      const n = parseInt(m[1]);
      return n >= 1 && n <= vs.length ? vs[n - 1] : null;
    }
  }

  // Nombre completo de la variante dentro del texto (el más largo gana:
  // "1000 ml tetra pak" sobre "1000 ml")
  const exactas = vs
    .filter((v) => t.includes(normalizar(v.titulo)))
    .sort((a, b) => b.titulo.length - a.titulo.length);
  if (exactas.length > 0) return exactas[0];

  // Pistas: alias y palabras sueltas del título, aplicadas como filtros
  // sucesivos (una pista que no deja ninguna candidata se ignora)
  const pistas: string[] = [];
  for (const [re, clave] of ALIAS_BOTELLA) if (re.test(t)) pistas.push(clave);
  for (const v of vs) {
    for (const palabra of normalizar(v.titulo).split(/[^a-z0-9]+/)) {
      if (palabra.length < 3 || PALABRAS_VACIAS.has(palabra) || pistas.includes(palabra)) continue;
      if (new RegExp(`\\b${palabra}\\b`).test(t)) pistas.push(palabra);
    }
  }

  let candidatas = vs;
  let filtro = false;
  for (const pista of pistas) {
    const f = candidatas.filter((v) => normalizar(v.titulo).includes(pista));
    if (f.length > 0) {
      candidatas = f;
      filtro = true;
    }
  }
  return filtro && candidatas.length === 1 ? candidatas[0] : null;
}

/** "Gran Reserva $313.400 · Carta de Oro $284.700 · ..." (para el catálogo de Sofi) */
export function lineaVariantes(producto: ProductoConVariantes, formatoPrecio: (n: number) => string): string {
  return variantesDe(producto)
    .filter((v) => v.inventario > 0)
    .map((v) => `${v.titulo} ${formatoPrecio(v.precio)}`)
    .join(' · ');
}

/** Pregunta con el listado numerado de variantes disponibles y su precio. */
export function preguntaVariante(producto: ProductoConVariantes, formatoPrecio: (n: number) => string): string {
  const vs = variantesDe(producto);
  const opciones = vs
    .map((v, i) => `*${i + 1}.* ${v.titulo} — ${v.inventario > 0 ? formatoPrecio(v.precio) : 'agotado'}`)
    .join('\n');
  return `¿Con cuál botella armas tu *${producto.titulo}*? El precio depende de la que elijas:\n\n${opciones}\n\n_Escribe el número o el nombre._`;
}
