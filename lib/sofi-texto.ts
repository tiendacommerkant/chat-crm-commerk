// Utilidades puras de texto para las respuestas de Sofi (sin dependencias,
// para poder probarlas de forma aislada).

/**
 * Garantiza que el texto termine preguntando la cantidad del producto. Si la
 * última pregunta del texto ya pide la cantidad se deja igual; si es otra
 * (ej. "¿Te la sumo al pedido?") se reemplaza por la pregunta de cantidad, y
 * si no hay ninguna se agrega al final.
 */
export function asegurarPreguntaCantidad(texto: string, tituloProducto: string, yaEnCarrito = 0): string {
  // Si el producto ya está en el carrito, la respuesta REEMPLAZA la cantidad
  // (no suma), así que la pregunta tiene que pedir el total sin ambigüedad.
  // Antes con 8 en el carrito, "¿cuántas quieres?" → "1" dejaba 9.
  if (yaEnCarrito > 0) {
    const t0 = texto.trim();
    const ini0 = t0.lastIndexOf('¿');
    const antes0 = (ini0 === -1 ? t0 : t0.slice(0, ini0)).trim();
    const preguntaTotal = `Ya tienes *${yaEnCarrito}* de *${tituloProducto}* en tu carrito. ¿Con cuántas unidades *en total* te quedas?`;
    return antes0 ? `${antes0}\n\n${preguntaTotal}` : preguntaTotal;
  }
  const pregunta = `¿Cuántas unidades de *${tituloProducto}* quieres?`;
  const t = texto.trim();
  const ini = t.lastIndexOf('¿');
  if (ini === -1) return `${t}\n\n${pregunta}`;
  const ultima = t.slice(ini);
  if (/cu[aá]nt[ao]s?|unidad|cantidad/i.test(ultima)) return t;
  const antes = t.slice(0, ini).trim();
  return antes ? `${antes}\n\n${pregunta}` : pregunta;
}
