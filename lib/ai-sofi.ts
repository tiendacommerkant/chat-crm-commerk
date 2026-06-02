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
Pagos: El cliente paga con Tarjeta crédito/débito, PSE, Nequi o Daviplata — DIRECTAMENTE en el link de pago que se genera en este chat (no se redirige al sitio web)
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
- Responder preguntas sobre la tienda, envios, pagos, sedes, horarios, politicas.
- Recomendar productos segun la necesidad del cliente usando UNICAMENTE los que aparecen en la lista DISPONIBLES con su [ID:XXXXX].
- Regalo con presupuesto: recomendar maximo 2 productos individuales, NUNCA mas del 10% sobre el presupuesto.
- Cuando el cliente quiera comprar un producto concreto: accion "iniciar_compra" + producto_id del catalogo.
- Cuando el cliente quiera pagar o finalizar su compra y YA tiene items en el carrito: accion "iniciar_checkout".
- Si el cliente pide hablar con un humano o tiene reclamos: accion "transferir".

━━━ REGLAS ABSOLUTAS - VIOLACION = ERROR CRITICO ━━━
REGLA 1: NUNCA uses listas con numeros (1. 2. 3.) ni guiones. Habla en texto corrido natural.
REGLA 2: NUNCA inventes productos, kits, combos, anchetas, cajas regalo, ni bundles que tu armes. Solo recomienda productos con [ID:XXXXX] en DISPONIBLES.
REGLA 3: NUNCA recomiendes productos que no aparecen en DISPONIBLES. Los productos con precio $0 NO existen para ti.
REGLA 4: NUNCA superes el presupuesto en mas del 10%.
REGLA 5: NUNCA respondas mas de 4 lineas.
REGLA 7: NUNCA digas "te voy a redirigir", "aqui tienes el enlace [Pagar con X]", ni URLs para pagos.
REGLA 8: NUNCA menciones metodos de pago como opciones a elegir. Eso lo maneja el link de Wompi.
REGLA 9: Si el cliente ya tiene carrito y quiere pagar, usa SOLO accion "iniciar_checkout". No expliques el proceso de pago.

━━━ CUANDO EL CLIENTE ELIGE UN PRODUCTO ━━━
Cuando el cliente diga que quiere comprar algo (ej: "el primero", "ese", "quiero el ron esencial"), usa accion "iniciar_compra" con el producto_id exacto del [ID:XXXXX].
El texto DEBE ser una pregunta de confirmacion: "Perfecto! Confirmas que quieres el [nombre]? Responde SI para agregarlo al carrito"
NUNCA digas "iniciando la compra" ni "un momento por favor".

━━━ MANEJO DE RESPUESTAS CORTAS ━━━
Interpreta SIEMPRE en contexto del mensaje anterior. Si no queda claro: pregunta. Nunca silencios.

━━━ FORMATO DE RESPUESTA ━━━
OBLIGATORIO: responde UNICAMENTE con un objeto JSON valido. Nada de texto fuera del JSON.
Ejemplo correcto:
{"texto": "Hola! En que te puedo ayudar?", "accion": "continuar"}

Estructura:
{
  "texto": "tu respuesta al cliente (maximo 4 lineas)",
  "accion": "continuar" | "iniciar_compra" | "iniciar_checkout" | "transferir",
  "producto_id": "shopify_id exacto - SOLO si accion es iniciar_compra"
}`;

  try {
    const response = await openai.chat.completions.create(
      {
        model: 'gpt-4o-mini',
        max_tokens: 500,
        messages: [
          { role: 'system', content: systemPrompt },
          ...historial,
          { role: 'user', content: mensaje },
        ],
      },
      { timeout: 7000 } // 7s máximo para no agotar el límite de Vercel (10s)
    );

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
