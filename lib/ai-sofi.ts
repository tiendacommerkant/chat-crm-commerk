// ============================================================
// SOFI — Agente IA de ventas de Tienda Commerk (OpenAI)
// ============================================================

import OpenAI from 'openai';
import type { BotContext, BotResponse } from '@/types';
import type { CartItem } from './bot-logic';
import { obtenerProductosCache } from './supabase';
import { formatearPrecioCOP, asignarEmojiProducto } from './shopify';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const COSTO_ENVIO        = parseInt(process.env.SHIPPING_COST || '8000');
const ENVIO_GRATIS_DESDE = parseInt(process.env.FREE_SHIPPING_THRESHOLD || '149000');
const COBERTURA          = (process.env.SHIPPING_COVERAGE || 'Medellín').split(',').map((c) => c.trim());
const BUSINESS_NAME      = process.env.BUSINESS_NAME || 'Tienda Commerk Antioquia';

function extraerJSON(raw: string): { texto: string; accion?: string; producto_id?: string } | null {
  const limpio = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const match = limpio.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
  }
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

  const formatarProducto = (p: typeof productos[0]) => {
    const emoji = asignarEmojiProducto(p.titulo);
    return `• [ID:${p.shopify_id}] ${emoji} ${p.titulo} | ${formatearPrecioCOP(p.precio)}`;
  };

  const catalogoTexto =
    `DISPONIBLES:\n${disponibles.map(formatarProducto).join('\n') || 'Ninguno por ahora.'}\n\n` +
    (agotados.length ? `AGOTADOS:\n${agotados.map((p) => `• ${p.titulo}`).join('\n')}` : '');

  let carritoInfo = 'Sin ítems en el carrito.';
  if (pendingCart.length > 0) {
    const sub   = pendingCart.reduce((s, i) => s + i.precio * i.cantidad, 0);
    const envio = sub >= ENVIO_GRATIS_DESDE ? 0 : COSTO_ENVIO;
    carritoInfo =
      `${pendingCart.length} ítem(s):\n` +
      pendingCart.map((i) => `  • ${i.titulo} ×${i.cantidad} = ${formatearPrecioCOP(i.precio * i.cantidad)}`).join('\n') +
      `\n  Total: ${formatearPrecioCOP(sub + envio)}${envio === 0 ? ' (envío GRATIS)' : ''}`;
  }

  const historial = context.mensajes_previos
    .slice(-14)
    .filter((m) => m.contenido?.trim())
    .map((m) => ({
      role: m.tipo === 'user' ? ('user' as const) : ('assistant' as const),
      content: m.contenido,
    }));

  const nombre = context.cliente.nombre?.split(' ')[0] ?? null;
  const sede   = context.cliente.sede_preferida ?? null;

  const systemPrompt = `Eres Sofi, asesora de ventas de ${BUSINESS_NAME}. Hablas en español colombiano natural, como una persona real por WhatsApp — cálida, cercana, directa.${nombre ? ` Cliente: ${nombre}.` : ''}${sede ? ` Sede: ${sede}.` : ''}

━━━ NEGOCIO ━━━
Web: https://tiendacommerkant.com.co
Sedes: CC Tesoro · CC Fabricato · Autopista Sur Itagüí · Gran Manzana Itagüí · Mall Indiana · Urabá-Apartadó
Envío: ${formatearPrecioCOP(COSTO_ENVIO)} — GRATIS en compras > ${formatearPrecioCOP(ENVIO_GRATIS_DESDE)} | Entrega 24-48h L-S
Cobertura: ${COBERTURA.join(', ')} y municipios del Área Metropolitana
Pagos: Tarjeta, PSE, Nequi, Daviplata — Wompi (100% seguro)

━━━ PRODUCTOS ━━━
${catalogoTexto}

━━━ CARRITO ACTUAL ━━━
${carritoInfo}

━━━ NOMBRES POPULARES ━━━
"esencial/licor caldas" → LICOR DE RON VIEJO DE CALDAS ESENCIAL
"tradicional/ron caldas/3 años" → RON VIEJO DE CALDAS TRADICIONAL
"oscuro/caldas oscuro" → RON VIEJO DE CALDAS OSCURO
"juan de la cruz/5 años" → RON VIEJO DE CALDAS JUAN DE LA CRUZ
"carta de oro/8 años" → RON VIEJO DE CALDAS CARTA DE ORO
"gran reserva/15 años/gre" → RON VIEJO DE CALDAS GRAN RESERVA ESPECIAL
"león dormido/21 años/doble roble" → RON VIEJO DE CALDAS LEÓN DORMIDO DOBLE ROBLE
"molendero/caña molendero" → LICOR DE CAÑA MOLENDERO
"cheers/crema ron" → CREMA DE RON CHEERS
"roble blanco/ron blanco" → RON VIEJO DE CALDAS ROBLE BLANCO
"amarillo/manzanares" → AGUARDIENTE AMARILLO DE MANZANARES

━━━ FORMATO — LEE ESTO CON ATENCIÓN ━━━
Estás en WhatsApp. La gente escribe rápido y lee en segundos. Reglas ABSOLUTAS:

NUNCA uses listas numeradas. NUNCA escribas "1." "2." "3." ni guiones "-" para listar opciones.
Si tienes varias opciones, escríbelas en texto corrido separadas por comas o en frases seguidas.

EJEMPLO DE CÓMO NO HACERLO (PROHIBIDO):
"Tienes estas opciones:
1. Ron Esencial $45.000
2. Ron Tradicional $75.000"

EJEMPLO DE CÓMO SÍ HACERLO (CORRECTO):
"Para ese presupuesto te recomiendo el Ron Esencial a $45.000, es el clásico de la casa, o el Ron Tradicional a $75.000 si quieres algo con más carácter. ¿Cuál te llama más?"

Máximo 4 líneas por mensaje. Sin emojis en exceso.
SOLO recomienda productos que aparezcan en PRODUCTOS DISPONIBLES. Nunca inventes kits ni combos.
Presupuesto de regalo: NUNCA superes el 10% sobre lo indicado.

━━━ CUANDO EL CLIENTE QUIERE COMPRAR ━━━
Cuando el cliente elija o confirme un producto específico, usa accion "iniciar_compra" con el ID exacto del [ID:XXXXX].
El texto DEBE preguntar la cantidad directamente. Ejemplo:
"¡Perfecto! ¿Cuántas unidades del [nombre] quieres?"
NUNCA digas "iniciando compra" ni "un momento" — pregunta la cantidad de una vez.

━━━ RESPUESTA JSON OBLIGATORIA ━━━
Responde SOLO con JSON válido, sin texto fuera:
{"texto": "tu mensaje (máx 4 líneas)", "accion": "continuar"|"iniciar_compra"|"transferir", "producto_id": "ID solo si iniciar_compra"}`;

  try {
    const response = await openai.chat.completions.create(
      {
        model: 'gpt-4o-mini',
        max_tokens: 400,
        temperature: 0.7,
        messages: [
          { role: 'system', content: systemPrompt },
          ...historial,
          { role: 'user', content: mensaje },
        ],
      },
      { timeout: 7000 }
    );

    const rawText = response.choices[0]?.message?.content || '';
    console.log('[Sofi] raw:', rawText.slice(0, 200));

    const parsed = extraerJSON(rawText);
    if (!parsed) throw new Error('JSON inválido de Sofi');

    const textoFinal = parsed.texto?.trim() || '¿Me puedes repetir? 😊';

    if (parsed.accion === 'transferir') {
      return {
        texto: textoFinal,
        accion: 'transferir_a_asesor',
        metadata: { awaiting: '', sofi_ia: true, pending_cart: pendingCart },
      };
    }

    if (parsed.accion === 'iniciar_compra' && parsed.producto_id) {
      const producto = productos.find((p) => p.shopify_id === parsed.producto_id);
      if (producto && producto.inventario > 0) {
        // Ir directo a 'cantidad' — no 'compra', para no necesitar confirmación extra
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
      // Producto no encontrado o agotado → continuar conversación
    }

    return {
      texto: textoFinal,
      metadata: { awaiting: '', sofi_ia: true, pending_cart: pendingCart },
    };

  } catch (error: any) {
    console.error('[Sofi] Error:', error?.message);
    return {
      texto: 'Disculpa, tuve un problema técnico. ¿Me repites qué necesitas? 😊',
      metadata: { awaiting: '', sofi_ia: true, pending_cart: pendingCart },
    };
  }
}
