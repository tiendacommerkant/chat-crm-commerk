// ============================================================
// SOFI — Agente conversacional de ventas (Anthropic claude-opus-5)
// ROL: solo recomienda y conversa. El checkout lo maneja bot-logic.
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import type { BotContext, BotResponse } from '@/types';
import type { CartItem } from './bot-logic';
import { obtenerProductosCache } from './supabase';
import { formatearPrecioCOP, asignarEmojiProducto } from './shopify';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const COSTO_ENVIO        = parseInt(process.env.SHIPPING_COST || '8000');
const ENVIO_GRATIS_DESDE = parseInt(process.env.FREE_SHIPPING_THRESHOLD || '149000');
const COBERTURA          = (process.env.SHIPPING_COVERAGE || 'Medellín').split(',').map((c) => c.trim());
const BUSINESS_NAME      = process.env.BUSINESS_NAME || 'Tienda Commerk Antioquia';

// Aliases para matching robusto sin depender del ID de GPT
const ALIASES_LOCAL = [
  { palabras: ['esencial', 'licor de ron', 'caldas esencial', 'licor caldas'], contiene: 'esencial' },
  { palabras: ['tradicional', '3 años', 'tres años', 'ron caldas', 'caldas tradicional'], contiene: 'tradicional' },
  { palabras: ['oscuro', 'caldas oscuro', 'ron oscuro'], contiene: 'oscuro' },
  { palabras: ['juan de la cruz', '5 años', 'cinco años', 'juan cruz'], contiene: 'juan' },
  { palabras: ['carta de oro', '8 años', 'ocho años', 'caldas carta'], contiene: 'carta de oro' },
  { palabras: ['gran reserva', '15 años', 'quince años', 'gre'], contiene: 'gran reserva' },
  { palabras: ['leon dormido', 'dormido', '21 años', 'doble roble'], contiene: 'dormido' },
  { palabras: ['molendero', 'licor de caña', 'caña'], contiene: 'molendero' },
  { palabras: ['cheers', 'crema ron', 'crema caldas', 'crema de ron'], contiene: 'cheers' },
  { palabras: ['roble blanco', 'ron blanco', 'caldas blanco', 'cocteleria'], contiene: 'roble blanco' },
  { palabras: ['amarillo', 'manzanares', 'aguardiente amarillo', 'aguardiente caldas'], contiene: 'amarillo' },
];

function encontrarProducto(productos: any[], idRaw?: string, nombreRaw?: string, textoExtra = '') {
  const busquedaTexto = ((nombreRaw || '') + ' ' + textoExtra).toLowerCase();

  // 1. Por ID limpio (solo dígitos)
  if (idRaw) {
    const idLimpio = String(idRaw).replace(/\D/g, '');
    const p = productos.find((p) => String(p.shopify_id) === idLimpio);
    if (p) { console.log('[Sofi] producto por ID:', p.titulo); return p; }
  }

  // 2. Por nombre exacto / substring
  if (nombreRaw) {
    const n = nombreRaw.toLowerCase();
    const p = productos.find((p) => {
      const t = p.titulo.toLowerCase();
      return t.includes(n) || n.includes(t.substring(0, 14));
    });
    if (p) { console.log('[Sofi] producto por nombre:', p.titulo); return p; }
  }

  // 3. Por aliases del banco de términos
  for (const alias of ALIASES_LOCAL) {
    if (alias.palabras.some((k) => busquedaTexto.includes(k))) {
      const p = productos.find((p) => p.titulo.toLowerCase().includes(alias.contiene));
      if (p) { console.log('[Sofi] producto por alias:', p.titulo); return p; }
    }
  }

  // 4. Por palabras largas del título en el texto
  const p = productos.find((prod) => {
    const palabras = prod.titulo.toLowerCase().split(' ').filter((w: string) => w.length > 4);
    return palabras.some((w: string) => busquedaTexto.includes(w));
  });
  if (p) { console.log('[Sofi] producto por palabras:', p.titulo); return p; }

  console.log('[Sofi] producto NO encontrado. id:', idRaw, 'nombre:', nombreRaw);
  return null;
}

function extraerJSON(raw: string): any | null {
  const limpio = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const match = limpio.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  const texto = limpio.replace(/^["']|["']$/g, '').trim();
  if (texto.length > 2) return { texto, accion: 'continuar' };
  return null;
}

export async function procesarMensajeSofi(
  mensaje: string,
  context: BotContext,
  pendingCart: CartItem[] = []
): Promise<BotResponse> {
  const productos = await obtenerProductosCache();
  const disponibles = productos.filter((p) => p.precio > 0 && p.inventario > 0);
  const agotados    = productos.filter((p) => p.precio > 0 && p.inventario <= 0);

  const descCorta = (p: any) => {
    const d = (p.descripcion || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return d ? ` — ${d.slice(0, 110)}` : '';
  };
  const catalogoTexto =
    `DISPONIBLES:\n` +
    disponibles.map((p) => `• [ID:${p.shopify_id}] ${asignarEmojiProducto(p.titulo)} ${p.titulo} | ${formatearPrecioCOP(p.precio)}${descCorta(p)}`).join('\n') +
    (agotados.length ? `\n\nAGOTADOS:\n` + agotados.map((p) => `• ${p.titulo}`).join('\n') : '');

  const carritoResumen = pendingCart.length > 0
    ? pendingCart.map((i) => `${i.titulo} ×${i.cantidad}`).join(', ') +
      ` | Total: ${formatearPrecioCOP(pendingCart.reduce((s, i) => s + i.precio * i.cantidad, 0))}`
    : 'vacío';

  const historial = context.mensajes_previos
    .slice(-12)
    .filter((m) => m.contenido?.trim())
    .map((m) => ({
      role: m.tipo === 'user' ? ('user' as const) : ('assistant' as const),
      content: m.contenido,
    }));

  const nombre = context.cliente.nombre?.split(' ')[0] ?? null;
  const sede   = context.cliente.sede_preferida ?? null;

  const system = `Eres Sofi, asesora de ventas de ${BUSINESS_NAME}. Español colombiano natural, cálida y directa. Máximo 3 líneas por respuesta.${nombre ? ` Cliente: ${nombre}.` : ''}${sede ? ` Sede: ${sede}.` : ''}

NEGOCIO
Sedes: CC Tesoro · CC Fabricato · Itagüí · Mall Indiana · Urabá
Envío: ${formatearPrecioCOP(COSTO_ENVIO)} — GRATIS > ${formatearPrecioCOP(ENVIO_GRATIS_DESDE)} | 24-48h | Zona: ${COBERTURA.join(', ')}
Pagos: Tarjeta, PSE, Nequi, Daviplata (Wompi)

CATÁLOGO
${catalogoTexto}

CARRITO ACTUAL: ${carritoResumen}

TÉRMINOS COMUNES
carta de oro/8 años → RON VIEJO DE CALDAS CARTA DE ORO
tradicional/3 años → RON VIEJO DE CALDAS TRADICIONAL
esencial → LICOR DE RON VIEJO DE CALDAS ESENCIAL
gran reserva/15 años/gre → RON VIEJO DE CALDAS GRAN RESERVA ESPECIAL
juan de la cruz/5 años → RON VIEJO DE CALDAS JUAN DE LA CRUZ
oscuro → RON VIEJO DE CALDAS OSCURO
leon/dormido/21 años → RON VIEJO DE CALDAS LEÓN DORMIDO DOBLE ROBLE
molendero → LICOR DE CAÑA MOLENDERO
cheers/crema → CREMA DE RON CHEERS
roble blanco/ron blanco → RON VIEJO DE CALDAS ROBLE BLANCO
amarillo/manzanares → AGUARDIENTE AMARILLO DE MANZANARES
OJO: "15 años" es GRAN RESERVA (no Juan de la Cruz, que es 5 años). Lee el número completo.

PRESENTACIONES (tamaños de botella)
media/media botella/mediecita → 375ml
botella/normal/entera → 750ml
litro → 1000ml
garrafa/litro y medio → 1500ml
Cuando el cliente pida un tamaño (ej. "tienes media?"), busca esa presentación del producto en el catálogo (ej. 375ml). Si esa presentación no está disponible, dilo y ofrece la que sí haya.

PERSONALIDAD
Experta en licores, cálida y segura. Vendes asesorando, nunca presionando. Haces sentir al cliente bien atendido y usas su nombre cuando lo sabes. Conoces a fondo cada producto del catálogo (úsa su descripción para recomendar con criterio: añejamiento, notas, ocasión).

REGLAS
- Habla en texto corrido y natural, máximo 3 líneas. NUNCA listas numeradas (1. 2. 3.) ni viñetas.
- SOLO hablas del negocio: productos, precios, regalos, ocasiones, maridaje, envíos, pagos y sedes. Si preguntan algo ajeno (clima, política, deportes, chistes, otros temas), redirige con calidez hacia cómo ayudar con nuestros licores. Nunca opines de temas externos.
- SOLO recomiendas productos del CATÁLOGO con su precio EXACTO. JAMÁS inventes productos, precios, promociones, descuentos, grados de alcohol ni existencias que no aparezcan arriba.
- Vende inteligente: propón el producto ideal según ocasión y presupuesto; si encaja, sugiere un complemento; si dudan por el precio, ofrece una opción más económica del catálogo.
- Presupuesto/regalo: recomienda dentro del monto, máximo 10% por encima.
- Si algo está agotado, ofrece de inmediato una alternativa disponible parecida.
- Solo vendemos a mayores de 18 años; si hay señales claras de que es menor, no continúes la venta.
- Si no sabes un dato puntual, ofrece conectar con un asesor en vez de inventar.
- Si el cliente saluda o retoma la charla y hay productos en CARRITO ACTUAL, salúdalo cálido (por su nombre si lo sabes) y retoma ese carrito con naturalidad, ej. "¡Hola de nuevo! Todavía tienes el [producto] esperándote, ¿lo terminamos o prefieres ver algo más?". Nunca listes opciones tipo menú.

TU ÚNICA DECISIÓN: ¿el cliente quiere comprar algo específico ahora?
SÍ → accion "iniciar_compra" + producto_id (número de [ID:XXXXX]) + producto_nombre
     Texto: "¡Perfecto! ¿Cuántas unidades de [nombre exacto] quieres?"
     (Aplica también si dice producto + cantidad, ej. "quiero 3 amarillos" o "dame 2 carta de oro".)
NO → accion "continuar" y sigue conversando

NUNCA preguntes cantidad, método de pago, dirección ni totales: el flujo de compra los maneja solo.
PROHIBIDO en tu texto: las palabras "sistema" o "procesando"; anunciar/prometer un total o confirmación "que viene"; y dar a entender que algo está "en proceso", "en un momento", "pendiente" o "esperando". No tienes nada corriendo en segundo plano: el resumen con el total aparece automáticamente, tú no lo describes ni lo prometes.
Si el cliente escribe solo un número ("1", "2", "3", etc.) → accion "continuar" con mensaje neutral; el flujo ya maneja las cantidades.
Si el cliente pide asesor humano → accion "transferir". En tu texto aclara SIEMPRE que un asesor continuará la atención aquí mismo, en este mismo chat de WhatsApp (no lo rediriges a otra línea ni número).

VARIOS PRODUCTOS A LA VEZ: si el cliente pide 2 o más productos/presentaciones distintas en un mismo mensaje (ej. "una botella y una garrafa"), usa accion "iniciar_compra" e incluye TODOS en "productos" (en el orden que los mencionó). El flujo pedirá las cantidades una por una. Tu texto solo confirma con naturalidad, sin preguntar cantidades.

RESPONDE SOLO JSON:
{"texto":"...","accion":"continuar|iniciar_compra|transferir","producto_id":"solo si iniciar_compra","producto_nombre":"nombre exacto del catálogo","productos":[{"producto_id":"...","producto_nombre":"..."}]}`;

  try {
    const response = await anthropic.messages.create(
      {
        model: 'claude-opus-5',
        max_tokens: 4096,
        thinking: { type: 'adaptive' },
        // effort 'low': respuestas ~2s más rápidas sin perder calidad
        // (clave en WhatsApp, donde el cliente espera en tiempo real)
        output_config: { effort: 'low' },
        system: [
          {
            type: 'text' as const,
            text: system,
            cache_control: { type: 'ephemeral' as const },
          },
        ],
        messages: [
          ...historial,
          { role: 'user', content: mensaje },
        ],
      },
      { timeout: 30000 }
    );

    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
    const rawText = textBlock?.text ?? '';
    console.log('[Sofi] raw:', rawText.slice(0, 400));

    const parsed = extraerJSON(rawText);
    if (!parsed?.texto) throw new Error('JSON sin texto');

    const textoFinal = parsed.texto.trim();

    if (parsed.accion === 'transferir') {
      return {
        texto: textoFinal,
        accion: 'transferir_a_asesor',
        metadata: { awaiting: '', sofi_ia: true, pending_cart: pendingCart },
      };
    }

    if (parsed.accion === 'iniciar_compra') {
      const enStock = productos.filter((p) => p.inventario > 0);

      // El cliente puede pedir varios productos a la vez ("una botella y una garrafa").
      // Resolvemos todos: el primero se pregunta ya, el resto queda en cola.
      const solicitados: Array<{ producto_id?: string; producto_nombre?: string }> =
        Array.isArray(parsed.productos) && parsed.productos.length > 0
          ? parsed.productos
          : [{ producto_id: parsed.producto_id, producto_nombre: parsed.producto_nombre }];

      const encontrados: string[] = [];
      for (const s of solicitados) {
        const p = encontrarProducto(enStock, s.producto_id, s.producto_nombre, textoFinal);
        if (p && !encontrados.includes(p.shopify_id)) encontrados.push(p.shopify_id);
      }

      const producto = encontrados.length > 0
        ? enStock.find((p) => p.shopify_id === encontrados[0])
        : null;

      if (producto) {
        const cola = encontrados.slice(1);
        // Si hay varios, preguntamos la cantidad del primero de forma explícita
        const texto = cola.length > 0
          ? `${textoFinal}\n\n¿Cuántas unidades de *${producto.titulo}* quieres?`
          : textoFinal;
        return {
          texto,
          metadata: {
            awaiting: 'cantidad',
            pending_product_id: producto.shopify_id,
            pending_queue: cola,
            pending_cart: pendingCart,
            sofi_ia: true,
          },
        };
      }

      // Producto no encontrado — pedir al cliente que aclare
      return {
        texto: textoFinal + '\n\nEscríbeme el nombre exacto del producto para añadirlo.',
        metadata: { awaiting: '', sofi_ia: true, pending_cart: pendingCart },
      };
    }

    return {
      texto: textoFinal,
      metadata: { awaiting: '', sofi_ia: true, pending_cart: pendingCart },
    };

  } catch (error: any) {
    console.error('[Sofi] Error:', error?.message);
    return {
      texto: 'Disculpa, tuve un problema. ¿Me repites qué necesitas? 😊',
      metadata: { awaiting: '', sofi_ia: true, pending_cart: pendingCart },
    };
  }
}
