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

interface SofiParsed {
  texto: string;
  accion?: string;
  producto_id?: string;
  producto_nombre?: string;
}

function extraerJSON(raw: string): SofiParsed | null {
  const limpio = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const match = limpio.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
  }
  const texto = limpio.replace(/^["']|["']$/g, '').trim();
  if (texto.length > 2) return { texto, accion: 'continuar' };
  return null;
}

function buscarProductoPorNombre(productos: any[], nombre: string) {
  if (!nombre) return null;
  const n = nombre.toLowerCase();
  // Búsqueda exacta por fragmento
  return productos.find((p) => {
    const t = p.titulo.toLowerCase();
    return t.includes(n) || n.includes(t.substring(0, 12));
  }) || null;
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
    `DISPONIBLES:\n${disponibles.map(formatarProducto).join('\n') || 'Ninguno.'}\n\n` +
    (agotados.length ? `AGOTADOS:\n${agotados.map((p) => `• ${p.titulo}`).join('\n')}` : '');

  let carritoInfo = 'Carrito vacío.';
  if (pendingCart.length > 0) {
    const sub   = pendingCart.reduce((s, i) => s + i.precio * i.cantidad, 0);
    const envio = sub >= ENVIO_GRATIS_DESDE ? 0 : COSTO_ENVIO;
    carritoInfo =
      pendingCart.map((i) => `  • ${i.titulo} ×${i.cantidad} = ${formatearPrecioCOP(i.precio * i.cantidad)}`).join('\n') +
      `\n  Total: ${formatearPrecioCOP(sub + envio)}`;
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
Sedes: CC Tesoro · CC Fabricato · Itagüí (Autopista Sur y Gran Manzana) · Mall Indiana · Urabá-Apartadó
Envío: ${formatearPrecioCOP(COSTO_ENVIO)} — GRATIS en compras > ${formatearPrecioCOP(ENVIO_GRATIS_DESDE)} | Entrega 24-48h
Cobertura: ${COBERTURA.join(', ')} y municipios del Área Metropolitana
Pagos: Tarjeta, PSE, Nequi, Daviplata — Wompi (100% seguro)

━━━ PRODUCTOS ━━━
${catalogoTexto}

━━━ CARRITO ACTUAL ━━━
${carritoInfo}

━━━ NOMBRES POPULARES ━━━
"esencial/licor caldas" → LICOR DE RON VIEJO DE CALDAS ESENCIAL
"tradicional/ron caldas/3 años" → RON VIEJO DE CALDAS TRADICIONAL
"oscuro" → RON VIEJO DE CALDAS OSCURO
"juan de la cruz/5 años" → RON VIEJO DE CALDAS JUAN DE LA CRUZ
"carta de oro/8 años" → RON VIEJO DE CALDAS CARTA DE ORO
"gran reserva/15 años/gre" → RON VIEJO DE CALDAS GRAN RESERVA ESPECIAL
"león dormido/21 años" → RON VIEJO DE CALDAS LEÓN DORMIDO DOBLE ROBLE
"molendero" → LICOR DE CAÑA MOLENDERO
"cheers/crema ron" → CREMA DE RON CHEERS
"roble blanco/ron blanco" → RON VIEJO DE CALDAS ROBLE BLANCO
"amarillo/manzanares" → AGUARDIENTE AMARILLO DE MANZANARES

━━━ REGLAS DE CONVERSACIÓN ━━━
NUNCA uses listas numeradas (1. 2. 3.). Habla en texto corrido.
Si tienes varias opciones: "Te recomiendo el Ron Esencial a $45.000 o el Tradicional a $75.000. ¿Cuál te llama más?"
Máximo 4 líneas. Solo recomienda lo que está en PRODUCTOS DISPONIBLES.
Presupuesto regalo: NUNCA superes el 10% sobre el monto indicado.

━━━ PROCESO DE COMPRA — REGLA CRÍTICA ━━━
Tu único rol es recomendar productos y activar la compra con iniciar_compra.
NUNCA hagas estas cosas — el sistema las maneja automáticamente:
- Preguntar cuántas unidades (❌ "¿Cuántas unidades quieres?")
- Calcular totales (❌ "Serían $138.000 por 2 unidades")
- Preguntar método de pago (❌ "¿Tarjeta, Nequi o PSE?")
- Preguntar dirección de envío
- Decir "iniciando compra" o "procesando tu pedido"

Cuando el cliente confirme que quiere un producto:
→ Usa accion "iniciar_compra" con el ID exacto del [ID:XXXXX] y el nombre exacto del catálogo
→ Tu texto debe ser solo una confirmación breve: "¡Perfecto, añadiendo al carrito! 🛒"
→ El sistema se encarga del resto automáticamente.

━━━ FORMATO JSON OBLIGATORIO ━━━
Responde SOLO con JSON válido:
{"texto": "tu mensaje (máx 4 líneas)", "accion": "continuar"|"iniciar_compra"|"transferir", "producto_id": "número exacto del ID", "producto_nombre": "nombre exacto del catálogo"}
producto_id y producto_nombre solo si accion es iniciar_compra.`;

  try {
    const response = await openai.chat.completions.create(
      {
        model: 'gpt-4o-mini',
        max_tokens: 350,
        temperature: 0.6,
        messages: [
          { role: 'system', content: systemPrompt },
          ...historial,
          { role: 'user', content: mensaje },
        ],
      },
      { timeout: 7000 }
    );

    const rawText = response.choices[0]?.message?.content || '';
    console.log('[Sofi] raw:', rawText.slice(0, 300));

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

    if (parsed.accion === 'iniciar_compra') {
      // Buscar producto: primero por ID exacto, luego por nombre
      let producto = parsed.producto_id
        ? productos.find((p) => p.shopify_id === String(parsed.producto_id).replace(/\D/g, ''))
        : null;

      if (!producto && parsed.producto_nombre) {
        producto = buscarProductoPorNombre(productos, parsed.producto_nombre);
      }

      // Último recurso: buscar en el texto de Sofi
      if (!producto) {
        const tl = textoFinal.toLowerCase();
        producto = productos.find((p) => {
          const palabras = p.titulo.toLowerCase().split(' ').filter((w) => w.length > 4);
          return palabras.some((w) => tl.includes(w));
        }) || null;
      }

      if (producto && producto.inventario > 0) {
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

      // Producto no encontrado — pedir al cliente que lo especifique
      return {
        texto: textoFinal + '\n\nEscribe el nombre exacto del producto para añadirlo al carrito.',
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
      texto: 'Disculpa, tuve un problema técnico. ¿Me repites qué necesitas? 😊',
      metadata: { awaiting: '', sofi_ia: true, pending_cart: pendingCart },
    };
  }
}
