import { NextResponse } from 'next/server';
import crypto from 'crypto';
import {
  buscarOCrearCliente,
  obtenerConversacionActiva,
  adquirirLockConversacion,
  liberarLockConversacion,
  guardarMensaje,
  obtenerHistorialMensajes,
  registrarVentaPendiente,
  supabaseAdmin,
} from '@/lib/supabase';
import { procesarMensajeBot } from '@/lib/bot-logic';
import { enviarMensajeWhatsApp, enviarImagenWhatsApp, formatearNumeroWhatsApp, marcarComoLeido } from '@/lib/whatsapp';
import { generarLinkPagoWompi } from '@/lib/wompi';
import { formatearPrecioCOP } from '@/lib/shopify';
import { esRecogidaEnTienda, nombreSedeDesdeDireccion } from '@/lib/sedes';
import { pasarAPendiente, devolverAlBot } from '@/lib/atencion';
import { obtenerHorario, avisoFueraDeHorario } from '@/lib/horario';
import { registrarEvento } from '@/lib/eventos';
import { leerEstadoConversacion, guardarEstadoConversacion } from '@/lib/estado';
import type { BotContext } from '@/types';

// El flujo hace IA + varias consultas + envío por WhatsApp. Sin esto, Vercel
// corta la función a los 10s y el cliente se queda sin respuesta.
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * Meta firma cada evento con el App Secret (X-Hub-Signature-256). Sin
 * verificarla, cualquiera podría inventar mensajes de clientes y hacer que el
 * bot responda o cree pedidos. Se exige en cuanto WHATSAPP_APP_SECRET existe.
 */
function firmaMetaValida(cuerpo: string, firma: string | null): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET || '';
  if (!appSecret) {
    console.warn('[WA] WHATSAPP_APP_SECRET no configurado: no se está verificando que los eventos vengan de Meta');
    return true;
  }
  if (!firma?.startsWith('sha256=')) return false;
  const esperada = Buffer.from('sha256=' + crypto.createHmac('sha256', appSecret).update(cuerpo, 'utf8').digest('hex'));
  const recibida = Buffer.from(firma);
  return esperada.length === recibida.length && crypto.timingSafeEqual(esperada, recibida);
}

export async function POST(req: Request) {
  try {
    const cuerpo = await req.text();
    if (!firmaMetaValida(cuerpo, req.headers.get('x-hub-signature-256'))) {
      // Si llegan muchos con firma de Meta pero inválida, la clave en Vercel está mal
      await registrarEvento('error', 'whatsapp',
        req.headers.get('x-hub-signature-256')
          ? 'Mensaje rechazado: la firma no coincide (revisa WHATSAPP_APP_SECRET en Vercel)'
          : 'Evento sin firma de Meta rechazado');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
    const body = JSON.parse(cuerpo);

    if (body.object === 'whatsapp_business_account') {
      for (const entry of body.entry) {
        for (const change of entry.changes) {

          // ── Actualizaciones de estado (entregado / leído) ─────────────
          if (change.value?.statuses) {
            for (const st of change.value.statuses) {
              const waMsgId: string = st.id;
              const estado: string = st.status; // 'sent' | 'delivered' | 'read' | 'failed'
              if (!waMsgId || !estado) continue;
              // Buscar el mensaje por whatsapp_message_id y actualizar estado_wa
              const { data: msgs } = await supabaseAdmin
                .from('mensajes')
                .select('id, metadata')
                .eq('metadata->>whatsapp_message_id', waMsgId)
                .limit(1);
              // Si Meta no pudo entregarlo (ej. una foto que rechaza), queda el
              // motivo: antes las fotos fallaban sin dejar ningún rastro.
              const errorWa = estado === 'failed' && st.errors?.[0]
                ? `${st.errors[0].code}: ${st.errors[0].title || st.errors[0].message || ''}`
                : null;
              if (errorWa) console.error('[WA] Mensaje no entregado:', waMsgId, errorWa);
              if (msgs?.length) {
                const m = msgs[0];
                await supabaseAdmin
                  .from('mensajes')
                  .update({ metadata: { ...m.metadata, estado_wa: estado, ...(errorWa && { error_wa: errorWa }) } })
                  .eq('id', m.id);
              }
            }
            continue;
          }

          if (!change.value?.messages) continue;

          const message = change.value.messages[0];
          const contact = change.value.contacts?.[0];
          // Clientes con nombre de usuario de WhatsApp que ocultan su número
          // llegan SIN `from`/`wa_id`: Meta solo manda su ID de usuario
          // (`from_user_id` / `user_id`, ej. "CO.1349..."). Antes se leía solo
          // `from`, el mensaje reventaba antes de guardarse y se perdía sin
          // rastro — ni respuesta ni registro en el CRM.
          const userIdWA: string | null = message.from_user_id || contact?.user_id || null;
          const usernameWA: string | null = contact?.profile?.username || null;
          const rawPhone: string | null = message.from || contact?.wa_id || null;
          // Destino de las respuestas: el número si vino; si no, el ID de usuario
          const phone: string | null = rawPhone ? formatearNumeroWhatsApp(rawPhone) : userIdWA;
          if (!phone) {
            console.error('[WA] Mensaje sin número ni ID de usuario, no se puede responder:', JSON.stringify(message).slice(0, 300));
            continue;
          }
          const messageId = message.id;
          const msgType: string = message.type || 'text';

          // Deduplicación: Meta puede reentregar el mismo mensaje (timeout,
          // reintento de red, etc.). Sin esto, dos entregas del mismo mensaje
          // se procesaban en paralelo, cada una leyendo el mismo "último estado"
          // y podían pisarse entre sí o responder dos veces. Si ya guardamos
          // este whatsapp_message_id como mensaje de usuario, es un reenvío.
          if (messageId) {
            const { data: yaExiste } = await supabaseAdmin
              .from('mensajes')
              .select('id')
              .eq('metadata->>whatsapp_message_id', messageId)
              .eq('tipo', 'user')
              .limit(1)
              .maybeSingle();
            if (yaExiste) {
              console.log(`[WA] Mensaje ${messageId} ya procesado — reentrega de Meta, se ignora.`);
              continue;
            }
          }

          if (messageId) await marcarComoLeido(messageId);

          const cliente = await buscarOCrearCliente(phone, contact?.profile?.name, {
            userId: userIdWA,
            username: usernameWA,
          });
          const conversacion = await obtenerConversacionActiva(cliente.id);

          // Reclamar la conversación: si el cliente manda dos mensajes casi
          // seguidos, cada uno llega como una invocación del webhook aparte y
          // podían procesarse en paralelo, pisándose el estado entre sí (pasó
          // en producción: un carrito real quedó vacío para siempre y el
          // cliente nunca recibió el link de pago). Con el lock, la segunda
          // invocación espera a que la primera termine de guardar su
          // respuesta antes de leer el historial.
          const lockToken = await adquirirLockConversacion(conversacion.id);
          try {

          // Si el agente tomó control, solo guardar el mensaje — no responder con bot
          const { data: convData } = await supabaseAdmin
            .from('conversaciones')
            .select('*')
            .eq('id', conversacion.id)
            .single();
          let botActivo = convData?.bot_activo !== false; // default true si columna no existe aún
          // Un asesor la tomó en el CRM: él responde, el bot no se la quita
          const atendidaPorAsesor = convData?.estado_atencion === 'en_atencion';

          // RED DE SEGURIDAD: si el bot está apagado esperando a un asesor y nadie
          // ha respondido en 30 min, lo reactivamos para no dejar al cliente hablando solo.
          if (!botActivo && !atendidaPorAsesor) {
            const { data: ultimoAgente } = await supabaseAdmin
              .from('mensajes')
              .select('created_at')
              .eq('conversacion_id', conversacion.id)
              .eq('metadata->>enviado_por', 'agente')
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            const { data: transferencia } = await supabaseAdmin
              .from('mensajes')
              .select('created_at')
              .eq('conversacion_id', conversacion.id)
              .eq('metadata->>transferido_a_asesor', 'true')
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            const refIso = ultimoAgente?.created_at || transferencia?.created_at;
            if (refIso) {
              const minutosSinAtencion = (Date.now() - new Date(refIso).getTime()) / 60000;
              if (minutosSinAtencion > 30) {
                await devolverAlBot(conversacion.id);
                botActivo = true;
                await registrarEvento('aviso', 'atencion',
                  `Conversación sin atender ${Math.round(minutosSinAtencion)} min: el bot volvió a responder`,
                  { conversacion_id: conversacion.id });
              }
            }
          }

          // ─── Determinar contenido y metadata según tipo ───────────────
          let texto = '';
          const metadata: Record<string, any> = {
            whatsapp_message_id: messageId,
            tipo_wa: msgType,
          };

          if (msgType === 'text') {
            texto = message.text?.body || '';

          } else if (msgType === 'image') {
            const mediaId = message.image?.id;
            metadata.media_id = mediaId;
            metadata.caption = message.image?.caption || '';
            metadata.media_mime_type = message.image?.mime_type || 'image/jpeg';
            if (mediaId) metadata.media_url = `/api/wa-media/${mediaId}`;
            texto = message.image?.caption || '📷 Imagen';

          } else if (msgType === 'audio') {
            const mediaId = message.audio?.id;
            metadata.media_id = mediaId;
            metadata.media_mime_type = message.audio?.mime_type || 'audio/ogg';
            if (mediaId) metadata.media_url = `/api/wa-media/${mediaId}`;
            texto = '🎤 Nota de voz';

          } else if (msgType === 'video') {
            const mediaId = message.video?.id;
            metadata.media_id = mediaId;
            metadata.caption = message.video?.caption || '';
            metadata.media_mime_type = message.video?.mime_type || 'video/mp4';
            if (mediaId) metadata.media_url = `/api/wa-media/${mediaId}`;
            texto = message.video?.caption || '🎥 Video';

          } else if (msgType === 'document') {
            const mediaId = message.document?.id;
            metadata.media_id = mediaId;
            metadata.filename = message.document?.filename || 'documento';
            metadata.media_mime_type = message.document?.mime_type || 'application/pdf';
            if (mediaId) metadata.media_url = `/api/wa-media/${mediaId}`;
            texto = `📄 ${metadata.filename}`;

          } else if (msgType === 'location') {
            metadata.latitude = message.location?.latitude;
            metadata.longitude = message.location?.longitude;
            metadata.name = message.location?.name || '';
            texto = `📍 Ubicación: ${metadata.name || `${metadata.latitude}, ${metadata.longitude}`}`;

          } else if (msgType === 'interactive') {
            const reply = message.interactive?.button_reply || message.interactive?.list_reply;
            texto = reply?.title || '';
            metadata.interactive_id = reply?.id || '';
            metadata.interactive_title = reply?.title || '';

          } else if (msgType === 'sticker') {
            texto = '🎭 Sticker';
            metadata.media_id = message.sticker?.id;

          } else {
            texto = `[${msgType}]`;
          }

          // Guardar mensaje entrante
          await guardarMensaje(conversacion.id, 'user', texto, metadata);

          // Si el agente tomó control manual, no responder con bot
          if (!botActivo) continue;

          // Solo responder con bot si es texto o respuesta interactiva
          if (msgType !== 'text' && msgType !== 'interactive') {
            const msgAcuse = '¡Hola! Recibimos tu mensaje. ¿En qué te podemos ayudar? 😊\n\nCuéntame qué producto buscas o qué necesitas.';
            await guardarMensaje(conversacion.id, 'bot', msgAcuse, { tipo_wa: 'text' });
            await enviarMensajeWhatsApp(phone, msgAcuse);
            continue;
          }

          const historial = await obtenerHistorialMensajes(conversacion.id, 15);
          const estado = await leerEstadoConversacion(conversacion.id);
          const contexto: BotContext = { cliente, conversacion, mensajes_previos: historial, estado };
          const respuesta = await procesarMensajeBot(texto, contexto);
          await guardarEstadoConversacion(conversacion.id, respuesta.metadata);

          // ── Acción: generar link de pago Wompi ─────────────────────────
          if (respuesta.accion === 'generar_link_pago' && respuesta.metadata) {
            const { pending_cart, pending_direccion, pending_total, pending_costo_envio } = respuesta.metadata;
            const cart: Array<{ shopify_id: string; titulo: string; precio: number; cantidad: number }> = pending_cart || [];
            const direccion = pending_direccion || 'Sin especificar';
            const total = pending_total || cart.reduce((s: number, i: any) => s + i.precio * i.cantidad, 0);

            // Guardar mensaje "generando link..."
            await guardarMensaje(conversacion.id, 'bot', respuesta.texto, {
              ...respuesta.metadata,
              tipo_wa: 'text',
            });
            await enviarMensajeWhatsApp(phone, respuesta.texto);

            if (cart.length === 0) {
              const msgError = `⚠️ No se encontraron productos en el carrito. Por favor intenta de nuevo.`;
              await guardarMensaje(conversacion.id, 'bot', msgError, { tipo_wa: 'text', awaiting: '' });
              await guardarEstadoConversacion(conversacion.id, { awaiting: '' });
              await enviarMensajeWhatsApp(phone, msgError);
              continue;
            }

            // Generar referencia única
            const referencia = `WA-${Date.now()}-${cliente.id.slice(0, 8)}`;

            // Nombre del link: primer producto o resumen
            const nombreLink = cart.length === 1
              ? `${cart[0].titulo} x${cart[0].cantidad}`
              : `Pedido Commerk (${cart.length} productos)`;

            // Descripción detallada para el link de Wompi
            const descripcionItems = cart
              .map((item) => `${item.titulo} x${item.cantidad}`)
              .join(', ');

            // Crear link de pago en Wompi
            const linkResult = await generarLinkPagoWompi({
              nombre: nombreLink,
              descripcion: `${descripcionItems} — Envío: ${direccion}`,
              monto: total,
              referencia,
              urlRedireccion: `${process.env.NEXT_PUBLIC_BASE_URL}/pago/confirmacion?ref=${referencia}`,
            });

            if (linkResult.success && linkResult.link) {
              // Registrar una venta pendiente por cada ítem del carrito
              for (const item of cart) {
                const itemTotal = Math.round((item.precio * item.cantidad / total) * total);
                await registrarVentaPendiente({
                  cliente_id: cliente.id,
                  conversacion_id: conversacion.id,
                  producto_shopify_id: item.shopify_id,
                  producto_nombre: item.titulo,
                  producto_precio: item.precio,
                  cantidad: item.cantidad,
                  total: item.precio * item.cantidad,
                  link_pago: linkResult.link,
                  referencia_pago: referencia,
                  direccion_envio: direccion,
                });
              }

              // Actualizar updated_at de la conversación
              await supabaseAdmin.from('conversaciones').update({ updated_at: new Date().toISOString() }).eq('id', conversacion.id);

              // Construir mensaje con detalle de todos los ítems
              let resumenItems = '';
              cart.forEach((item, i) => {
                resumenItems += `${i + 1}. ${item.titulo} × ${item.cantidad} = ${formatearPrecioCOP(item.precio * item.cantidad)}\n`;
              });

              const msgLink =
                `✅ *¡Tu link de pago está listo!*\n\n` +
                resumenItems +
                `\n💵 Total: *${formatearPrecioCOP(total)}*\n` +
                (esRecogidaEnTienda(direccion)
                  ? `🏪 Recoges en: *${nombreSedeDesdeDireccion(direccion)}*\n`
                  : (pending_costo_envio === 0 ? `🎁 Envío: *GRATIS*\n` : `🚚 Envío incluido\n`)) +
                `\n🔗 *Paga aquí directamente:*\n${linkResult.link}\n\n` +
                `💳 Puedes pagar con *Nequi, Daviplata, PSE o Tarjeta* — elige tu método dentro del link.\n\n` +
                `_Link de un solo uso y 100% seguro con Wompi. Una vez confirmado el pago te avisamos aquí y procesamos tu pedido._ ✅`;

              const metaLink = {
                tipo_wa: 'text',
                awaiting: 'link_enviado',
                referencia_pago: referencia,
                pending_cart: cart,
              };
              await guardarMensaje(conversacion.id, 'bot', msgLink, metaLink);
              await guardarEstadoConversacion(conversacion.id, metaLink);
              await enviarMensajeWhatsApp(phone, msgLink);

            } else {
              // Fallo al generar el link
              const msgError =
                `⚠️ Hubo un problema generando el link de pago. Por favor intenta de nuevo o escríbenos directamente.\n\n` +
                `Error: ${linkResult.error || 'Desconocido'}`;
              await guardarMensaje(conversacion.id, 'bot', msgError, { tipo_wa: 'text', awaiting: '' });
              await guardarEstadoConversacion(conversacion.id, { awaiting: '' });
              await enviarMensajeWhatsApp(phone, msgError);
            }

            continue;
          }

          // ── Acción: enviar foto real del producto (Shopify) ─────────────
          if (respuesta.accion === 'enviar_foto' && respuesta.metadata?.imagen_url) {
            const imagenes: Array<{ url: string; caption: string }> = respuesta.metadata.imagenes || [];

            // Varias fotos ("fotos de esas opciones"): primero el texto y luego
            // cada foto con su nombre y precio. Cada mensaje se guarda con el
            // estado completo, porque el último mensaje del bot es el que manda.
            if (imagenes.length > 1) {
              const resTexto = await enviarMensajeWhatsApp(phone, respuesta.texto);
              await guardarMensaje(conversacion.id, 'bot', respuesta.texto, {
                ...respuesta.metadata,
                tipo_wa: 'text',
                whatsapp_message_id: resTexto.messageId || null,
              });
              for (const img of imagenes) {
                const resImg = await enviarImagenWhatsApp(phone, img.url, img.caption);
                if (!resImg.success) console.error('[WA] Falló el envío de la foto de producto:', resImg.error);
                await guardarMensaje(conversacion.id, 'bot', img.caption, {
                  ...respuesta.metadata,
                  tipo_wa: 'image',
                  media_url: img.url,
                  whatsapp_message_id: resImg.messageId || null,
                });
              }
              continue;
            }

            const imagenUrl: string = respuesta.metadata.imagen_url;
            const resultadoImg = await enviarImagenWhatsApp(phone, imagenUrl, respuesta.texto);

            // Si la imagen falló (ej. formato que WhatsApp rechaza), no dejamos
            // al cliente sin nada: mandamos el texto solo como respaldo.
            let messageId = resultadoImg.messageId;
            if (!resultadoImg.success) {
              console.error('[WA] Falló el envío de la foto de producto:', resultadoImg.error);
              messageId = (await enviarMensajeWhatsApp(phone, respuesta.texto)).messageId;
            }

            // Con el ID de WhatsApp, el estado de entrega (o el error si Meta
            // la rechaza después) queda registrado en el mensaje.
            await guardarMensaje(conversacion.id, 'bot', respuesta.texto, {
              ...respuesta.metadata,
              tipo_wa: resultadoImg.success ? 'image' : 'text',
              media_url: imagenUrl,
              whatsapp_message_id: messageId || null,
            });
            continue;
          }

          // ── Acción: transferir al asesor humano (Sofi no puede ayudar) ──
          if (respuesta.accion === 'transferir_a_asesor') {
            // Si hay un flujo activo (checkout, mayorista...) y Sofi transfirió sin
            // que el cliente lo pidiera, NO apagamos el bot: apagarlo dejaba al
            // cliente sin respuesta a mitad del proceso. Pero si el cliente pidió
            // EXPLÍCITAMENTE una persona ("quiero hablar con un asesor") hay que
            // respetarlo siempre: en pruebas reales Sofi le prometía "un asesor
            // continúa contigo aquí mismo" y el bot seguía contestando solo. La red
            // de seguridad de 30 min reactiva el bot si nadie atiende.
            // Paso en que iba el cliente antes de este mensaje (estado guardado o último mensaje del bot)
            const awaitingPrevio = estado ? estado.datos?.awaiting : [...historial].reverse().find((m) => m.tipo === 'bot')?.metadata?.awaiting;
            const pideHumano = /\b(asesor(a)?|humano|humana|persona|agente|representante|encargado|alguien)\b/i.test(texto);
            // La derivación mayorista ya avisó a la sede: ahí sí se pasa el chat siempre
            const derivacionMayorista = respuesta.metadata?.derivacion === 'mayorista';
            // Problema con el pago o cliente molesto: el bot no puede resolverlo, se pasa siempre
            const transferenciaObligatoria = ['pago', 'frustracion'].includes(respuesta.metadata?.motivo_transferencia);
            const flujoActivo = !!awaitingPrevio && !pideHumano && !derivacionMayorista && !transferenciaObligatoria;

            // Fuera del horario del equipo se le dice al cliente cuándo le escriben
            const aviso = flujoActivo ? '' : avisoFueraDeHorario(await obtenerHorario());
            const textoTransferencia = aviso ? `${respuesta.texto}\n\n${aviso}` : respuesta.texto;

            await guardarMensaje(conversacion.id, 'bot', textoTransferencia, {
              ...respuesta.metadata,
              tipo_wa: 'text',
              transferido_a_asesor: true,
              fuera_de_horario: !!aviso,
            });
            await enviarMensajeWhatsApp(phone, textoTransferencia);

            if (!flujoActivo) {
              // El bot se apaga y la conversación entra a "Pendientes" del CRM
              const motivo = derivacionMayorista ? 'mayorista'
                : pideHumano ? 'cliente_pidio_asesor'
                : (respuesta.metadata?.motivo_transferencia as string) || 'sofi';
              await pasarAPendiente(conversacion.id, motivo);

              // Etiqueta visible en el CRM para que el equipo vea que es un lead mayorista
              // (no pisa una etiqueta que ya tenga, ej. "Compró").
              if (derivacionMayorista) {
                await supabaseAdmin
                  .from('conversaciones')
                  .update({ etiqueta: 'mayorista' })
                  .eq('id', conversacion.id)
                  .is('etiqueta', null);
              }
            } else {
              console.warn('[WA] Transferencia solicitada con flujo activo — el bot sigue activo para no dejar al cliente sin respuesta');
            }
            continue;
          }

          // ── Respuesta normal del bot ───────────────────────────────────
          await guardarMensaje(conversacion.id, 'bot', respuesta.texto, {
            ...respuesta.metadata,
            tipo_wa: 'text',
          });
          await enviarMensajeWhatsApp(phone, respuesta.texto);

          // Actualizar timestamp de la conversación
          await supabaseAdmin
            .from('conversaciones')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', conversacion.id);

          } finally {
            await liberarLockConversacion(conversacion.id, lockToken);
          }
        }
      }
      return NextResponse.json({ success: true }, { status: 200 });
    }

    return NextResponse.json({ success: false }, { status: 400 });
  } catch (error: any) {
    await registrarEvento('error', 'whatsapp', `Error procesando un mensaje: ${error?.message || error}`);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }
  return new NextResponse('Forbidden', { status: 403 });
}
