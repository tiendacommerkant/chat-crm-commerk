// Utilidades puras de texto para las respuestas de Sofi (sin dependencias,
// para poder probarlas de forma aislada).

/**
 * Garantiza que el texto termine preguntando la cantidad del producto. Si la
 * última pregunta del texto ya pide la cantidad se deja igual; si es otra
 * (ej. "¿Te la sumo al pedido?") se reemplaza por la pregunta de cantidad, y
 * si no hay ninguna se agrega al final.
 */
export function asegurarPreguntaCantidad(texto: string, tituloProducto: string): string {
  const pregunta = `¿Cuántas unidades de *${tituloProducto}* quieres?`;
  const t = texto.trim();
  const ini = t.lastIndexOf('¿');
  if (ini === -1) return `${t}\n\n${pregunta}`;
  const ultima = t.slice(ini);
  if (/cu[aá]nt[ao]s?|unidad|cantidad/i.test(ultima)) return t;
  const antes = t.slice(0, ini).trim();
  return antes ? `${antes}\n\n${pregunta}` : pregunta;
}
