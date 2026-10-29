// ============================================================
// SOFI — Agente conversacional de ventas (Anthropic claude-opus-5)
// ROL: solo recomienda y conversa. El checkout lo maneja bot-logic.
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import type { BotContext, BotResponse } from '@/types';
import type { CartItem } from './bot-logic';
import { obtenerProductosCache } from './supabase';
import { formatearPrecioCOP, asignarEmojiProducto } from './shopify';
import { registrarUsoClaude } from './costos';
import { matchProductoDistintivo } from './matching';
import { asegurarPreguntaCantidad, quitarUltimaPregunta } from './sofi-texto';
import {
  variantesDe, varianteDe, resolverVariante, lineaVariantes, preguntaVariante,
  tituloConVariante, codificarPendiente, decodificarPendiente,
} from './variantes';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  // Sofi responde en ~4s: 12s es margen de sobra y evita que un fallo de red
  // deje al cliente esperando. Reintenta solo/o ante errores transitorios.
  timeout: 12_000,
  maxRetries: 2,
});

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
  // 1. Por ID limpio (solo dígitos) — la vía más confiable, siempre primero
  if (idRaw) {
    const idLimpio = String(idRaw).replace(/\D/g, '');
    const p = productos.find((p) => String(p.shopify_id) === idLimpio);
    if (p) { console.log('[Sofi] producto por ID:', p.titulo); return p; }
  }

  // 2. Por nombre exacto (substring completo en ambos sentidos — sin trucos
  //    de prefijo truncado, que hacían coincidir productos distintos que
  //    comparten las primeras letras, ej. toda la familia "Ron Viejo de Caldas")
  if (nombreRaw) {
    const n = nombreRaw.toLowerCase().trim();
    const p = productos.find((p) => {
      const t = p.titulo.toLowerCase();
      return t === n || t.includes(n) || n.includes(t);
    });
    if (p) { console.log('[Sofi] producto por nombre:', p.titulo); return p; }
  }

  // 3. Por aliases del banco de términos (términos curados y específicos,
  //    no genéricos — seguro por diseño)
  const busquedaTexto = ((nombreRaw || '') + ' ' + textoExtra).toLowerCase();
  for (const alias of ALIASES_LOCAL) {
    if (alias.palabras.some((k) => busquedaTexto.includes(k))) {
      const p = productos.find((p) => p.titulo.toLowerCase().includes(alias.contiene));
      if (p) { console.log('[Sofi] producto por alias:', p.titulo); return p; }
    }
  }

  // 4. Última red de seguridad: exige TODAS las palabras distintivas del
  //    título (sin palabras genéricas de marca) y solo responde si NO hay
  //    ambigüedad. Si 0 o 2+ productos califican, devuelve null — nunca
  //    adivina un producto que el cliente no pidió.
  const p = matchProductoDistintivo(productos, busquedaTexto);
  if (p) { console.log('[Sofi] producto por match distintivo:', p.titulo); return p; }

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
  // Kits "Arma tu kit": el precio depende de la botella, así que Sofi ve el de
  // cada una (antes veía uno solo, el más caro, y lo daba para cualquier botella)
  const precioCatalogo = (p: any) => {
    const vs = lineaVariantes(p, formatearPrecioCOP);
    return vs ? `según botella: ${vs}` : formatearPrecioCOP(p.precio);
  };
  const catalogoTexto =
    `DISPONIBLES:\n` +
    disponibles.map((p) => `• [ID:${p.shopify_id}] ${asignarEmojiProducto(p.titulo)} ${p.titulo} | ${precioCatalogo(p)}${descCorta(p)}`).join('\n') +
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
Sedes: CC Tesoro · CC Fabricato · Autopista Sur (Itagüí) · Gran Manzana (Itagüí) · Mall Indiana · Urabá (Apartadó) · Parque Comercial Florida
Envío: ${COSTO_ENVIO === 0 ? 'GRATIS siempre, sin monto mínimo' : `${formatearPrecioCOP(COSTO_ENVIO)} — GRATIS > ${formatearPrecioCOP(ENVIO_GRATIS_DESDE)}`} | 24-48h | Zona: ${COBERTURA.join(', ')}
Pagos: Tarjeta, PSE, Nequi, Daviplata (Wompi)
COBERTURA DE DOMICILIO: SOLO los municipios listados en "Zona". Nunca digas "Valle de Aburrá", "toda el área metropolitana" ni menciones otros municipios como cubiertos. Si preguntan por uno que no está en la lista (ej. Itagüí, Rionegro), di que no está en la cobertura estándar de domicilio y ofrece la opción de recoger en tienda. No agregues condiciones de envío que no estén escritas arriba (nada de "hábiles" u otros detalles). (Los pedidos empresariales tienen su propia condición de envío: ver VENTAS EMPRESARIALES.)

VENTAS EMPRESARIALES (temporada de fin de año)
Es empresarial quien compra A NOMBRE DE UNA EMPRESA para regalar a sus colaboradores, empleados o clientes: anchetas, aguinaldos, regalos corporativos o de fin de año, "convenio empresarial", "tengo una empresa", "para mis empleados/clientes/colaboradores", áreas como Talento Humano, Bienestar o Compras, o una cotización para una compañía. Con cualquier cantidad.
Lo que ofrecemos (dilo con estas condiciones, sin inventar porcentajes, precios por volumen ni plazos):
- Sí manejamos convenio empresarial: le enviamos nuestra propuesta para sus colaboradores al correo electrónico.
- Precio especial para sus anchetas en nuestros productos regulares (ron, aguardiente, cócteles), empaque de regalo gratis y obsequios sujetos a disponibilidad.
- Requisitos para el descuento empresarial: RUT actualizado; el certificado bancario es opcional.
- Catálogo: nuestro catálogo digital está en desarrollo; todos los productos están en https://tiendacommerkant.com.co y por WhatsApp le ampliamos la información que necesite.
- Envío: no tiene costo adicional; los regalos llegan en carro y durante la temporada llevamos sus aguinaldos hasta la dirección que requiera. Si pregunta por una ciudad puntual fuera de la Zona, dile que el equipo empresarial se lo confirma en la propuesta.
Si la conversación ya es empresarial y todavía no ha dado su correo, responde su duda con lo de arriba e invítalo a compartir el correo para enviarle la propuesta.

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
- DESCUENTOS: no tienes cupones ni descuentos para ofrecer y no debes prometer que "consultas" uno. Si preguntan si hay descuento, responde con honestidad y sin evasivas: los precios del catálogo ya son los vigentes, el envío es como dice arriba en "Envío", y solo mencionas una promo si aparece escrita en el nombre de un producto del catálogo (ej. un producto que diga "Promo" en el nombre). La única excepción es el convenio empresarial (ver VENTAS EMPRESARIALES). Si van a comprar en volumen para revender o surtir un negocio usa accion "mayorista"; si es una empresa que regala a su gente o a sus clientes, accion "empresarial".
- KITS CON BOTELLA A ELEGIR: en los productos con "según botella" el precio cambia según la botella (o el tamaño) que se elija, y cada precio ya incluye esa botella. NUNCA digas que cuestan lo mismo con cualquier botella ni des un solo precio sin decir de cuál botella es. Si el cliente aún no eligió, da el rango ("desde $X") o el precio de las botellas que le interesen.
- Vende inteligente: propón el producto ideal según ocasión y presupuesto; si encaja, sugiere un complemento; si dudan por el precio, ofrece una opción más económica del catálogo.
- Presupuesto/regalo: recomienda dentro del monto, máximo 10% por encima.
- Si algo está agotado, ofrece de inmediato una alternativa disponible parecida.
- Solo vendemos a mayores de 18 años; si hay señales claras de que es menor, no continúes la venta.
- Si no sabes un dato puntual que NO es crítico para decidir la compra (horario exacto de una sede, fotos del producto, detalles de añejamiento que no estén en la descripción, beneficios de un programa VIP, etc.), dilo con honestidad en una frase corta y sigue ayudando con lo que sí sabes (recomendaciones, precios, disponibilidad). NUNCA ofrezcas conectar con un asesor por esto: la conversación se pausa esperando a esa persona y el cliente puede quedar sin respuesta. Reserva "transferir" solo para lo que de verdad necesita una persona (ver REGLA de transferir abajo).
- Si el cliente saluda o retoma la charla y hay productos en CARRITO ACTUAL, salúdalo cálido (por su nombre si lo sabes) y retoma ese carrito con naturalidad, ej. "¡Hola de nuevo! Todavía tienes el [producto] esperándote, ¿lo terminamos o prefieres ver algo más?". Nunca listes opciones tipo menú.

TU DECISIÓN (elige UNA acción):

1) "iniciar_compra" → el cliente eligió un producto concreto para llevar.
   Incluye producto_id (número de [ID:XXXXX]) + producto_nombre.
   Texto: "¡Perfecto! ¿Cuántas unidades de [nombre exacto] quieres?"
   Aplica también con producto + cantidad ("quiero 3 amarillos") y cuando
   escoge entre opciones que acabas de ofrecer ("sería como un amarillo",
   "el carta de oro", "ese mismo", "el primero").
   Si es un producto "según botella" y el cliente ya dijo cuál botella,
   incluye "variante" con el nombre exacto de esa opción (ej. "Carta de Oro");
   si no lo dijo, omítela: el flujo le pregunta con los precios.

2) "finalizar_compra" → hay algo en CARRITO ACTUAL y el cliente quiere cerrar,
   pagar o terminar. Da igual cómo lo escriba, incluso con errores de tipeo:
   "ya finalicemos", "finalicmeos", "listo", "ya", "cerremos", "dale pues",
   "eso es todo", "nada más", "quiero pagar", "cóbrame", "hasta ahí".
   Texto: una frase corta y cálida de cierre, SIN pedir datos.
   ⚠️ Ante la duda entre continuar y finalizar, elige "finalizar_compra":
   el flujo se encarga del resto y el cliente no queda atascado.

3) "continuar" → conversas, recomiendas o resuelves dudas.

4) "enviar_foto" → el cliente pide ver/una foto/imagen de un producto concreto
   (recién mencionado, en su carrito, o que nombra claro). Incluye producto_id
   + producto_nombre. Texto: una frase corta tipo "¡Claro! Aquí tienes 📸"
   (el flujo adjunta la imagen real, tú no la describes). Nunca uses
   "transferir" por pedidos de foto. Si pide fotos de VARIOS productos ("fotos
   de esas opciones", "de los dos"), inclúyelos todos en "productos" (máximo 3).
   NUNCA digas "te muestro", "aquí tienes" o "te comparto la foto" sin devolver
   "enviar_foto": si no la devuelves, el cliente no recibe ninguna imagen.

5) "ajustar_carrito" → el cliente quiere CAMBIAR la cantidad de un producto
   que YA está en CARRITO ACTUAL, o quitarlo: "solo una", "déjame 2", "no 9,
   una", "quita el amarillo", "mejor ninguna". Incluye producto_id del producto
   del carrito y "cantidad" = el número TOTAL final que quiere (0 = quitarlo).
   Texto: una frase corta confirmando; el flujo muestra el carrito actualizado.
   Tú SÍ puedes ajustar el carrito: NUNCA uses "transferir" ni digas que un
   asesor lo ajusta. Si hay dos botellas distintas del mismo kit en el carrito,
   incluye "variante" con la que quiere ajustar.

6) "empresarial" → quien escribe compra para una EMPRESA (ver VENTAS
   EMPRESARIALES): primer mensaje en que lo notas. Texto: responde su mensaje
   con las condiciones que apliquen, sin pedir datos (el flujo le pide el
   correo para enviarle la propuesta).

OJO NÚMEROS: "¿es el de 8 años?", "el de 750 ml", "el litro", "15 años" hablan
del PRODUCTO (añejamiento, tamaño), NO de cuántas unidades quiere.

🚫 PROHIBIDO ABSOLUTO — esto lo hace el flujo automático, TÚ NO:
- Pedir o confirmar la DIRECCIÓN de entrega.
- Preguntar o confirmar el MÉTODO DE PAGO (Nequi, PSE, tarjeta...).
- Preguntar la cantidad por tu cuenta (solo en el texto de "iniciar_compra").
- Decir que anotaste, guardaste o registraste un dato: tú no guardas nada.
- Decir "seguimos con el pago/la entrega", "continuemos para cerrar" o similar
  sin devolver la accion "finalizar_compra". Si el cliente quiere cerrar,
  la acción correcta es "finalizar_compra", NUNCA una frase de relleno.
Si el cliente da su dirección o dice un método de pago por su cuenta, responde
"finalizar_compra" (el flujo se los pedirá bien), sin repetirlos como confirmados.
PROHIBIDO en tu texto: las palabras "sistema" o "procesando"; anunciar/prometer un total o confirmación "que viene"; y dar a entender que algo está "en proceso", "en un momento", "pendiente" o "esperando". No tienes nada corriendo en segundo plano: el resumen con el total aparece automáticamente, tú no lo describes ni lo prometes.
Si el cliente escribe solo un número ("1", "2", "3", etc.) → accion "continuar" con mensaje neutral; el flujo ya maneja las cantidades.
TRANSFERIR → accion "transferir" SOLO cuando el cliente pida explícitamente hablar con una persona/asesor/humano, o cuando haya una queja, reclamo o problema de pago que de verdad necesite intervención humana. NUNCA la uses por un dato que simplemente no tienes (ver regla de arriba). En tu texto aclara SIEMPRE que un asesor continuará la atención aquí mismo, en este mismo chat de WhatsApp (no lo rediriges a otra línea ni número).
COMPRAS POR VOLUMEN → accion "mayorista": SOLO si el cliente dice explícitamente un número mayor a 12 unidades de un mismo producto, pide una lista grande de varios productos por cantidad, o usa palabras claras de intención comercial ("mayorista", "al por mayor", "para mi negocio", "para revender", "para mi evento/tienda"). NO es mayorista una empresa que compra regalos para sus colaboradores o clientes, aunque sean cientos de unidades: eso es "empresarial". Ante la duda, si hay una empresa de por medio y no es para revender, "empresarial". Una mención vaga de "cajas", "varias unidades" o similar SIN número exacto NO es mayorista: pregúntale cuántas unidades exactas quiere y síguelo atendiendo normal. Tampoco es mayorista una pregunta sobre un producto o servicio que NO está en el catálogo (ej. llantas, repuestos, materiales de construcción): ahí redirige con calidez a lo que sí vendemos, nunca actives "mayorista" solo porque el mensaje contiene la frase "por mayor". Cuando sí aplica mayorista, el flujo automático le muestra las sedes y avisa a la sede elegida; tu texto solo dice, corto, que lo conectas con la sede más cercana. NUNCA prometas que "la sede te confirma/contacta", precios por volumen, descuentos ni tiempos: eso lo hace el flujo, no tú.

VARIOS PRODUCTOS A LA VEZ: si el cliente pide 2 o más productos/presentaciones distintas en un mismo mensaje (ej. "una botella y una garrafa"), usa accion "iniciar_compra" e incluye TODOS en "productos" (en el orden que los mencionó). El flujo pedirá las cantidades una por una. Tu texto solo confirma con naturalidad, sin preguntar cantidades.

RESPONDE SOLO JSON:
{"texto":"...","accion":"continuar|iniciar_compra|finalizar_compra|mayorista|empresarial|transferir|enviar_foto|ajustar_carrito","producto_id":"si iniciar_compra, enviar_foto o ajustar_carrito","producto_nombre":"nombre exacto del catálogo","variante":"botella elegida, solo en productos según botella","cantidad":"solo si ajustar_carrito: total final","productos":[{"producto_id":"...","producto_nombre":"...","variante":"..."}]}`;

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
    );

    // Registrar consumo real de tokens para el panel de costos (no bloquea)
    registrarUsoClaude('claude-opus-5', response.usage as any).catch(() => {});

    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
    const rawText = textBlock?.text ?? '';
    console.log('[Sofi] raw:', rawText.slice(0, 400));

    const parsed = extraerJSON(rawText);
    if (!parsed?.texto) throw new Error('JSON sin texto');

    const textoFinal = parsed.texto.trim();

    // El cliente quiere cerrar el pedido: NO improvisamos nada aquí.
    // Devolvemos la señal y el flujo de checkout toma el control.
    if (parsed.accion === 'finalizar_compra' && pendingCart.length > 0) {
      return {
        texto: textoFinal,
        accion: 'iniciar_checkout',
        metadata: { awaiting: '', sofi_ia: true, pending_cart: pendingCart },
      };
    }

    // Compra por volumen / corporativa: el flujo de bot-logic muestra las sedes y
    // avisa a la sede elegida (Sofi solo clasifica, no promete nada).
    if (parsed.accion === 'mayorista') {
      return {
        texto: textoFinal,
        accion: 'iniciar_mayorista',
        metadata: { awaiting: '', sofi_ia: true, pending_cart: pendingCart },
      };
    }

    if (parsed.accion === 'transferir') {
      return {
        texto: textoFinal,
        accion: 'transferir_a_asesor',
        metadata: { awaiting: '', sofi_ia: true, pending_cart: pendingCart },
      };
    }

    // Compra empresarial (regalos de fin de año para colaboradores o clientes):
    // bot-logic pide el correo y le pasa el lead al equipo de ventas empresariales.
    if (parsed.accion === 'empresarial') {
      return {
        texto: textoFinal,
        accion: 'iniciar_empresarial',
        metadata: { awaiting: '', sofi_ia: true, pending_cart: pendingCart },
      };
    }

    if (parsed.accion === 'iniciar_compra') {
      const enStock = productos.filter((p) => p.inventario > 0);

      // El cliente puede pedir varios productos a la vez ("una botella y una garrafa").
      // Resolvemos todos: el primero se pregunta ya, el resto queda en cola.
      const solicitados: Array<{ producto_id?: string; producto_nombre?: string; variante?: string }> =
        Array.isArray(parsed.productos) && parsed.productos.length > 0
          ? parsed.productos
          : [{ producto_id: parsed.producto_id, producto_nombre: parsed.producto_nombre, variante: parsed.variante }];

      // Cada entrada es "idProducto" o "idProducto|idVariante" si ya se sabe la botella
      const encontrados: string[] = [];
      for (const s of solicitados) {
        const p = encontrarProducto(enStock, s.producto_id, s.producto_nombre, textoFinal);
        if (!p) continue;
        // La botella que dijo Sofi o, si pidió un solo producto, la que nombró el cliente
        const variante = resolverVariante(p, s.variante) ||
          (solicitados.length === 1 ? resolverVariante(p, mensaje) : null);
        const entrada = codificarPendiente(p.shopify_id, variante?.id);
        if (!encontrados.includes(entrada)) encontrados.push(entrada);
      }

      const primero = encontrados.length > 0 ? decodificarPendiente(encontrados[0]) : null;
      const producto = primero ? enStock.find((p) => p.shopify_id === primero.productoId) : null;

      if (producto) {
        const cola = encontrados.slice(1);
        const variante = varianteDe(producto, primero?.varianteId);

        // Kit con botella a elegir y el cliente no dijo cuál (o la que dijo está
        // agotada): se le pregunta mostrando el precio de cada una.
        if (variantesDe(producto).length > 0 && (!variante || variante.inventario <= 0)) {
          const intro = quitarUltimaPregunta(textoFinal);
          const aviso = variante ? `La botella *${variante.titulo}* está agotada para este kit 😕\n\n` : '';
          return {
            texto: `${intro ? `${intro}\n\n` : ''}${aviso}${preguntaVariante(producto, formatearPrecioCOP)}`,
            metadata: {
              awaiting: 'variante',
              pending_product_id: producto.shopify_id,
              pending_queue: cola,
              pending_cart: pendingCart,
              sofi_ia: true,
            },
          };
        }

        // El estado pasa a "esperando cantidad", así que el texto DEBE terminar
        // preguntando la cantidad. En pruebas reales Sofi a veces cerraba con
        // "¿Te la sumo al pedido?" y el cliente contestaba "sí" sin que el bot
        // esperara un sí sino un número. Se garantiza aquí, sin depender de que
        // el modelo obedezca la instrucción del prompt.
        const yaEnCarrito = pendingCart.find(
          (i) => i.shopify_id === producto.shopify_id && (i.variant_id || null) === (variante?.id || null)
        )?.cantidad || 0;
        const texto = asegurarPreguntaCantidad(textoFinal, tituloConVariante(producto.titulo, variante), yaEnCarrito);
        return {
          texto,
          metadata: {
            awaiting: 'cantidad',
            pending_product_id: producto.shopify_id,
            pending_variant_id: variante?.id || null,
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

    if (parsed.accion === 'ajustar_carrito') {
      const n = Number(parsed.cantidad);
      const cantidadFinal = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
      const prod = encontrarProducto(productos, parsed.producto_id, parsed.producto_nombre, textoFinal);
      // Solo se ajusta algo que ya está en el carrito; si hay un único
      // producto, "solo una" se refiere a ese aunque Sofi no lo nombre exacto.
      // Con dos botellas del mismo kit en el carrito, decide la variante.
      const delProducto = prod ? pendingCart.filter((i) => i.shopify_id === prod.shopify_id) : [];
      const varianteAjuste = prod ? resolverVariante(prod, parsed.variante) : null;
      const item =
        (delProducto.length === 1 ? delProducto[0] : delProducto.find((i) => i.variant_id && i.variant_id === varianteAjuste?.id)) ||
        (pendingCart.length === 1 ? pendingCart[0] : null);

      if (item && cantidadFinal !== null) {
        return {
          texto: textoFinal,
          accion: 'ajustar_carrito',
          metadata: {
            awaiting: '',
            sofi_ia: true,
            pending_cart: pendingCart,
            ajuste_carrito: { shopify_id: item.shopify_id, variant_id: item.variant_id || null, cantidad: cantidadFinal },
          },
        };
      }

      return {
        texto: pendingCart.length > 0
          ? `${textoFinal}\n\n¿De cuál producto y cuántas unidades en total quieres dejar?`
          : textoFinal,
        metadata: { awaiting: '', sofi_ia: true, pending_cart: pendingCart },
      };
    }

    if (parsed.accion === 'enviar_foto') {
      // "Me mandas fotos de esas opciones": hasta 3 productos, cada foto con su
      // nombre y precio. Antes solo se resolvía uno y el resto se perdía.
      const pedidos: Array<{ producto_id?: string; producto_nombre?: string }> =
        Array.isArray(parsed.productos) && parsed.productos.length > 0
          ? parsed.productos.slice(0, 3)
          : [{ producto_id: parsed.producto_id, producto_nombre: parsed.producto_nombre }];
      const resueltos: any[] = [];
      for (const s of pedidos) {
        // Con varios, el texto de Sofi nombra a todos: no sirve para desempatar
        const p = encontrarProducto(productos, s.producto_id, s.producto_nombre, pedidos.length === 1 ? textoFinal : '');
        if (p && !resueltos.some((r) => r.shopify_id === p.shopify_id)) resueltos.push(p);
      }
      const conFoto = resueltos.filter((p) => p.imagen_url);
      const producto = conFoto[0] || resueltos[0] || null;
      const precioFoto = (p: any) =>
        variantesDe(p).length > 0 ? `desde ${formatearPrecioCOP(p.precio)}` : formatearPrecioCOP(p.precio);

      if (producto?.imagen_url) {
        return {
          texto: textoFinal,
          accion: 'enviar_foto',
          metadata: {
            awaiting: '',
            sofi_ia: true,
            pending_cart: pendingCart,
            imagen_url: producto.imagen_url,
            imagen_producto: producto.titulo,
            ...(conFoto.length > 1 && {
              imagenes: conFoto.map((p) => ({ url: p.imagen_url, titulo: p.titulo, caption: `*${p.titulo}* — ${precioFoto(p)}` })),
            }),
          },
        };
      }

      // Sin foto disponible o producto ambiguo: honesto, SIN transferir — se
      // sigue atendiendo normal en vez de dejar la conversación en pausa.
      return {
        texto: producto
          ? `Por ahora no tengo foto cargada de *${producto.titulo}*, pero te cuento con gusto cómo es si quieres. 😊`
          : `No logré identificar cuál producto, ¿me confirmas el nombre exacto para buscarte la foto?`,
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
