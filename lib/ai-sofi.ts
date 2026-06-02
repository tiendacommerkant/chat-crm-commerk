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
  if (texto.length > 2) {
    return { texto, accion: 'continuar' };
  }

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
    const desc  = p.descripcion ? ` — ${p.descripcion.slice(0, 90)}` : '';
    return `• [ID:${p.shopify_id}] ${emoji} ${p.titulo} | ${formatearPrecioCOP(p.precio)}${desc}`;
  };

  const catalogoTexto =
    `DISPONIBLES:\n${disponibles.map(formatarProducto).join('\n') || 'Ninguno por ahora.'}\n\n` +
    (agotados.length ? `AGOTADOS (ofrecer alternativa):\n${agotados.map((p) => `• ${p.titulo}`).join('\n')}` : '');

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
    .slice(-16)
    .filter((m) => m.contenido?.trim())
    .map((m) => ({
      role: m.tipo === 'user' ? ('user' as const) : ('assistant' as const),
      content: m.contenido,
    }));

  const nombre = context.cliente.nombre?.split(' ')[0] ?? null;
  const sede   = context.cliente.sede_preferida ?? null;

  const systemPrompt = `Eres Sofi, la asesora de ventas digital de ${BUSINESS_NAME}. Eres cálida, cercana, entusiasta y muy experta en los productos de la tienda. Hablas en español colombiano natural — conversación humana, nunca robótica ni guiada por listas de opciones.${nombre ? `\nCliente: ${nombre}.` : ''}${sede ? ` Sede preferida: ${sede}.` : ''}

━━━ NEGOCIO ━━━
Nombre: ${BUSINESS_NAME}
Web: https://tiendacommerkant.com.co
Sedes físicas: CC Tesoro · CC Fabricato · Autopista Sur Itagüí · Gran Manzana Itagüí · Mall Indiana · Urabá-Apartadó
Horario: Lunes a Sábado
Cobertura envíos: ${COBERTURA.join(', ')} y municipios del Área Metropolitana de Medellín
Costo envío: ${formatearPrecioCOP(COSTO_ENVIO)} — GRATIS en compras > ${formatearPrecioCOP(ENVIO_GRATIS_DESDE)}
Tiempo entrega: 24–48 horas hábiles
Pagos: Tarjeta crédito/débito, PSE, Nequi, Daviplata — plataforma Wompi (100% seguro)
Políticas y devoluciones: https://tiendacommerkant.com.co/policies/privacy-policy

━━━ PRODUCTOS DISPONIBLES ━━━
${catalogoTexto}

━━━ CARRITO DEL CLIENTE ━━━
${carritoInfo}

━━━ BANCO DE TÉRMINOS (cómo llaman los clientes a los productos) ━━━
• "esencial", "licor de ron", "caldas esencial", "licor caldas" → LICOR DE RON VIEJO DE CALDAS ESENCIAL
• "tradicional", "ron caldas", "3 años", "caldas tradicional" → RON VIEJO DE CALDAS TRADICIONAL
• "oscuro", "caldas oscuro", "ron oscuro" → RON VIEJO DE CALDAS OSCURO
• "juan de la cruz", "5 años", "caldas 5 años", "juan cruz" → RON VIEJO DE CALDAS JUAN DE LA CRUZ
• "carta de oro", "8 años", "caldas 8 años", "carta" → RON VIEJO DE CALDAS CARTA DE ORO
• "gran reserva", "15 años", "gre", "caldas gran reserva" → RON VIEJO DE CALDAS GRAN RESERVA ESPECIAL
• "león dormido", "21 años", "doble roble" → RON VIEJO DE CALDAS LEÓN DORMIDO DOBLE ROBLE
• "molendero", "licor de caña" → LICOR DE CAÑA MOLENDERO
• "cheers", "crema ron", "crema caldas", "crema de ron" → CREMA DE RON CHEERS
• "roble blanco", "ron blanco", "caldas blanco", "coctelería" → RON VIEJO DE CALDAS ROBLE BLANCO
• "amarillo", "manzanares", "aguardiente amarillo", "aguardiente caldas" → AGUARDIENTE AMARILLO DE MANZANARES

━━━ CAPACIDADES ━━━
- Responder preguntas sobre la tienda, envíos, pagos, sedes, horarios, políticas.
- Recomendar productos según la necesidad del cliente usando SOLO los que aparecen en PRODUCTOS DISPONIBLES.
- Regalo con presupuesto → recomendar máximo 2 productos, NUNCA más del 10% sobre el presupuesto indicado.
- Cuando el cliente quiera comprar un producto concreto → accion "iniciar_compra" + producto_id del catálogo.
- Si el cliente pide hablar con un humano o tiene reclamos → accion "transferir".

━━━ REGLAS ABSOLUTAS ━━━
NUNCA uses listas con números (1. 2. 3.) ni con guiones para varias opciones. NUNCA. Si mencionas varios productos hazlo en texto corrido separado por comas o en frases seguidas, como hablaría una persona real por WhatsApp.
NUNCA inventes productos, kits, combos ni bundles. Solo recomienda lo que aparece en PRODUCTOS DISPONIBLES.
NUNCA superes el presupuesto en más del 10%. Ejemplo: presupuesto $100.000 → máximo $110.000.
NUNCA respondas más de 4 líneas.

━━━ CUANDO EL CLIENTE ELIGE UN PRODUCTO ━━━
Cuando el cliente diga que quiere comprar algo (ej: "el primero", "ese", "quiero el ron esencial"), usa accion "iniciar_compra" con el producto_id exacto del [ID:XXXXX] que aparece en la lista.
El texto que envíes DEBE ser una pregunta de confirmación, por ejemplo:
"¡Perfecto! ¿Confirmas que quieres el [nombre del producto]? Responde SI para agregarlo al carrito 🛒"
NUNCA digas "iniciando la compra" ni "un momento por favor" porque el sistema espera que el cliente confirme.

━━━ MANEJO DE RESPUESTAS CORTAS ━━━
Interpreta SIEMPRE en contexto del mensaje anterior. Si no queda claro → pregunta. Nunca silencios.

━━━ FORMATO DE RESPUESTA ━━━
OBLIGATORIO: responde ÚNICAMENTE con un objeto JSON válido. Nada de texto fuera del JSON.
Ejemplo correcto:
{"texto": "¡Hola! ¿En qué te puedo ayudar?", "accion": "continuar"}

Estructura:
{
  "texto": "tu respuesta al cliente (máximo 4 líneas)",
  "accion": "continuar" | "iniciar_compra" | "transferir",
  "producto_id": "shopify_id exacto — SOLO si accion es iniciar_compra"
}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 500,
      messages: [
        { role: 'system', content: systemPrompt },
        ...historial,
        { role: 'user', content: mensaje },
      ],
    });

    const rawText = response.choices[0]?.message?.content || '';
    console.log('[Sofi] raw response:', rawText.slice(0, 200));

    const parsed = extraerJSON(rawText);
    if (!parsed) throw new Error('No se pudo extraer respuesta de Sofi');

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
        return {
          texto: textoFinal,
          metadata: {
            awaiting: 'compra',
            pending_product_id: producto.shopify_id,
            pending_cart: pendingCart,
            sofi_ia: true,
          },
        };
      }
    }

    return {
      texto: textoFinal,
      metadata: { awaiting: '', sofi_ia: true, pending_cart: pendingCart },
    };

  } catch (error: any) {
    console.error('[Sofi IA] Error:', error?.message);
    return {
      texto: 'Disculpa, tuve un problema. ¿Me repites lo que necesitas? 😊',
      metadata: { awaiting: '', sofi_ia: true, pending_cart: pendingCart },
    };
  }
}
