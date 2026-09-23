// ============================================================
// MATCHING DE PRODUCTOS — última red de seguridad, sin adivinar
// ============================================================
// Reemplaza heurísticas anteriores (prefijo de 14 caracteres, "cualquier
// palabra >3/4 letras") que hacían match por palabras GENÉRICAS compartidas
// por toda una familia de productos (ej. "ron", "viejo", "caldas" aparecen
// en casi todos los Ron Viejo de Caldas). Esas heurísticas podían devolver
// silenciosamente el producto EQUIVOCADO incluso cuando el nombre recibido
// era exacto y correcto — el peor tipo de error porque no se nota.
//
// Estrategia: cada producto puntúa según cuántas de sus palabras DISTINTIVAS
// (sin genéricas de marca) aparecen en el texto de búsqueda. Gana el producto
// con más coincidencias; si dos o más empatan en el máximo, es ambiguo y se
// devuelve null en vez de adivinar. Todos los call sites ya manejan null
// pidiéndole al cliente que aclare.
//
// Esto es deliberadamente más permisivo que "debe contener TODAS las
// palabras del título" (que fallaba con catálogos reales de títulos largos,
// ej. "gran reserva" sin decir "especial 750ml" no encontraba nada), pero
// sigue siendo seguro: palabras distintivas de sabores/variantes DIFERENTES
// (oscuro, tradicional, carta de oro, gran reserva, juan de la cruz...) no se
// solapan entre sí, así que nunca compiten por el mismo match. El único
// terreno de ambigüedad real que puede quedar es entre PRESENTACIONES o
// EDICIONES del MISMO producto (ej. "Oscuro 700ml" vs "Oscuro 700ml Edición
// Especial") — ahí se pide aclarar en vez de arriesgar, que es el
// comportamiento correcto.

const PALABRAS_GENERICAS = new Set([
  'ron', 'viejo', 'de', 'del', 'la', 'el', 'los', 'las', 'caldas', 'licor', 'ml',
]);

function normalizar(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

// Escapa caracteres especiales de regex. El catálogo real tiene títulos con
// paréntesis, pipes, guiones — ej. "Papas MonteRojo BBQ Dulce (100 g)" o
// "Arma tu Ancheta Caja M | Regalos...". Sin escapar, un token como "(100"
// rompe new RegExp() con una excepción no capturada, lo que tumbaría la
// respuesta del bot para cualquier mensaje que tocara este camino.
function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// El catálogo escribe el tamaño a veces pegado ("750ml") y a veces con
// espacio ("750 ml", "100 g", "1.5  litros"). Sin unir esto, el número queda
// suelto (se filtra por ser solo dígitos) y la unidad sola es genérica —
// se pierde el tamaño como palabra distintiva y presentaciones distintas del
// mismo producto empatan entre sí en vez de distinguirse por tamaño.
function unirTamanos(s: string): string {
  return s.replace(/(\d+(?:[.,]\d+)?)\s+(ml|g|kg|l|litros?)\b/gi, '$1$2');
}

function tokensDistintivos(titulo: string): string[] {
  return unirTamanos(normalizar(titulo))
    // separadores: espacios, guiones (incluye variantes largas), pipes,
    // puntuación y paréntesis/corchetes — cualquier símbolo que no sea
    // parte de una palabra o número
    .split(/[\s\-–—×.,|()[\]]+/)
    .filter((w) => w.length > 3 && !PALABRAS_GENERICAS.has(w) && !/^\d+$/.test(w));
}

/**
 * Busca, entre `productos`, el que mejor coincide con `textoBusqueda` por
 * número de palabras distintivas de su título presentes en el texto. Si el
 * mejor puntaje está empatado entre 2+ productos, o nadie tiene ninguna
 * coincidencia, devuelve null en vez de arriesgarse a adivinar mal.
 */
export function matchProductoDistintivo<T extends { titulo: string }>(
  productos: T[],
  textoBusqueda: string
): T | null {
  if (!textoBusqueda?.trim()) return null;
  const texto = unirTamanos(normalizar(textoBusqueda));

  const puntuados = productos
    .map((p) => {
      const tokens = tokensDistintivos(p.titulo);
      const coincidencias = tokens.filter((tok) =>
        new RegExp(`(^|[^a-z0-9])${escaparRegex(tok)}`).test(texto)
      ).length;
      return { p, coincidencias };
    })
    .filter((x) => x.coincidencias > 0)
    .sort((a, b) => b.coincidencias - a.coincidencias);

  if (puntuados.length === 0) return null;
  const empatado = puntuados.length > 1 && puntuados[1].coincidencias === puntuados[0].coincidencias;
  if (empatado) return null;

  return puntuados[0].p;
}
