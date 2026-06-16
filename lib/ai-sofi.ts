// ============================================================
// SOFI — Agente conversacional de ventas (Anthropic claude-opus-4-7)
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

  const catalogoTexto =
    `DISPONIBLES:\n` +
    disponibles.map((p) => `• [ID:${p.shopify_id}] ${asignarEmojiProducto(p.titulo)} ${p.titulo} | ${formatearPrecioCOP(p.precio)}`).join('\n') +
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

REGLAS
- Habla en texto corrido. NUNCA listas con 1. 2. 3. — usa comas o frases seguidas.
- Solo recomienda productos del catálogo. Sin inventar combos ni precios.
- Presupuesto regalo: máximo 10% sobre el monto dado.
- Si el producto está agotado, ofrece uno disponible.

TU ÚNICA DECISIÓN: ¿el cliente quiere comprar algo específico ahora?
SÍ → accion "iniciar_compra" + producto_id (número de [ID:XXXXX]) + producto_nombre
     Texto: "¡Perfecto! ¿Cuántas unidades de [nombre exacto] quieres?"
NO → accion "continuar" y sigue conversando

NUNCA preguntes cantidad, método de pago, dirección ni totales. El sistema lo maneja.
Si el cliente escribe solo un número ("1", "2", "3", etc.) → accion "continuar" con mensaje neutral. El sistema ya maneja las cantidades.
Si el cliente pide asesor humano → accion "transferir"

RESPONDE SOLO JSON:
{"texto":"...","accion":"continuar|iniciar_compra|transferir","producto_id":"solo si iniciar_compra","producto_nombre":"nombre exacto del catálogo"}`;

  try {
    const response = await anthropic.messages.create(
      {
        model: 'claude-opus-4-7',
        max_tokens: 4096,
        thinking: { type: 'adaptive' },
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
      const producto = encontrarProducto(
        productos.filter((p) => p.inventario > 0),
        parsed.producto_id,
        parsed.producto_nombre,
        textoFinal
      );

      if (producto) {
        return {
          texto: textoFinal,
          metadata: {
            awaiting: 'cantidad',
            pending_product_id: producto.shopify_id,
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
