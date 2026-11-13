// Validación de la zona de domicilio a partir del texto de la dirección.
// Sin dependencias para poder probarla de forma aislada.

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function contiene(textoNorm: string, nombre: string): boolean {
  const n = normalizar(nombre);
  return n.length > 0 && new RegExp(`(^| )${n}( |$)`).test(textoNorm);
}

// Municipios de Antioquia y ciudades principales FUERA de la zona de domicilio.
// No es necesario que esté completa: si la dirección no nombra ningún
// municipio reconocible, se le pregunta al cliente en vez de adivinar.
const FUERA_DE_ZONA = [
  'Itagüí', 'Guarne', 'Rionegro', 'Marinilla', 'La Ceja', 'El Retiro', 'Retiro',
  'El Carmen de Viboral', 'Carmen de Viboral', 'El Santuario', 'La Unión', 'Girardota',
  'Barbosa', 'San Jerónimo', 'Santa Fe de Antioquia', 'Sopetrán', 'Amagá', 'Angelópolis',
  'Heliconia', 'Ebéjico', 'San Pedro de los Milagros', 'Don Matías', 'Santa Rosa de Osos',
  'Yarumal', 'Apartadó', 'Turbo', 'Caucasia', 'Chigorodó', 'Carepa', 'Necoclí', 'Arboletes',
  'Guatapé', 'El Peñol', 'San Vicente', 'Cocorná', 'Granada', 'Concepción', 'Santo Domingo',
  'Cisneros', 'San Roque', 'Yolombó', 'Amalfi', 'Anorí', 'Ituango', 'Valdivia', 'Tarazá',
  'Cáceres', 'El Bagre', 'Zaragoza', 'Segovia', 'Remedios', 'Puerto Berrío', 'Puerto Nare',
  'Puerto Triunfo', 'Sonsón', 'Abejorral', 'Fredonia', 'Venecia', 'Titiribí', 'Jericó',
  'Andes', 'Jardín', 'Ciudad Bolívar', 'Urrao', 'Frontino', 'Dabeiba', 'Cañasgordas',
  'Betulia', 'Concordia', 'Salgar', 'Támesis', 'Valparaíso', 'Santa Bárbara', 'La Pintada',
  'San Carlos', 'San Luis', 'San Rafael', 'Entrerríos', 'Belmira', 'Angostura', 'Mutatá',
  'Bogotá', 'Cali', 'Pereira', 'Manizales', 'Cartagena', 'Barranquilla', 'Bucaramanga',
  'Armenia', 'Montería', 'Santa Marta', 'Ibagué', 'Villavicencio', 'Cúcuta', 'Pasto',
  'Neiva', 'Popayán', 'Tunja', 'Sincelejo', 'Valledupar', 'Quibdó',
];

// Barrios/comunas muy conocidos de Medellín que la gente escribe sin poner
// "Medellín" (ej. "Calle 10 #43-20, El Poblado").
const BARRIOS_MEDELLIN = [
  'El Poblado', 'Poblado', 'Laureles', 'Estadio', 'Belén', 'Robledo', 'Castilla',
  'Aranjuez', 'Manrique', 'Buenos Aires', 'La Candelaria', 'Guayabal', 'La América',
  'San Javier', 'Villa Hermosa', 'Doce de Octubre', 'Conquistadores', 'Florida Nueva',
  'San Antonio de Prado', 'Santa Elena', 'Calasanz', 'Boston', 'Prado Centro',
  'Las Palmas', 'Provenza', 'Patio Bonito', 'Ciudad del Río', 'Carlos E Restrepo',
  'Suramericana', 'Velódromo', 'La Floresta', 'Simón Bolívar', 'Pilarica', 'Campo Valdés',
  'Loma de los Bernal', 'Los Colores', 'Manila', 'Castropol', 'El Tesoro',
];

/**
 * Tiempo de entrega que se le promete al cliente, desde la confirmación del
 * pago. Pedido del equipo (13 nov): con más pedidos no se puede prometer el
 * mismo día ni el siguiente. Se usa en Sofi, en las respuestas del bot y en la
 * confirmación del pago: cambiarlo aquí lo cambia en todas partes.
 */
export const TIEMPO_ENTREGA = '3 a 5 días hábiles';

/** El texto es exactamente el nombre de un municipio conocido (dentro o fuera de la zona). */
export function esNombreDeMunicipio(texto: string, cobertura: string[] = []): boolean {
  const t = normalizar(texto);
  return !!t && [...cobertura, ...FUERA_DE_ZONA, 'Medellín'].some((m) => normalizar(m) === t);
}

export type ResultadoCobertura =
  | { estado: 'dentro'; municipio: string }
  | { estado: 'fuera'; municipio: string }
  | { estado: 'desconocido' };

/**
 * - 'fuera': la dirección nombra un municipio fuera de la zona (y ninguno dentro).
 * - 'dentro': nombra un municipio de la zona (o un barrio conocido de Medellín).
 * - 'desconocido': no se puede saber con certeza → hay que preguntarle al cliente.
 */
export function evaluarCobertura(direccion: string, cobertura: string[]): ResultadoCobertura {
  const t = normalizar(direccion);
  const dentro = cobertura.filter((m) => m && contiene(t, m));
  const fuera = FUERA_DE_ZONA.filter((m) => contiene(t, m) && !cobertura.some((c) => normalizar(c) === normalizar(m)));

  if (fuera.length > 0 && dentro.length === 0) return { estado: 'fuera', municipio: fuera[0] };
  if (dentro.length > 0 && fuera.length === 0) return { estado: 'dentro', municipio: dentro[0] };
  if (dentro.length > 0 && fuera.length > 0) return { estado: 'desconocido' }; // ambigua: preguntar

  const barrio = BARRIOS_MEDELLIN.find((b) => contiene(t, b));
  if (barrio && cobertura.some((c) => normalizar(c) === 'medellin')) return { estado: 'dentro', municipio: 'Medellín' };
  return { estado: 'desconocido' };
}
