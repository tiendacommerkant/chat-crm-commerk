import { NextResponse } from 'next/server';
import {
  buscarOCrearCliente,
  obtenerConversacionActiva,
  guardarMensaje,
  obtenerHistorialMensajes,
  registrarVentaPendiente,
  supabaseAdmin,
} from '@/lib/supabase';
import { procesarMensajeBot } from '@/lib/bot-logic';
import { enviarMensajeWhatsApp, formatearNumeroWhatsApp, marcarComoLeido } from '@/lib/whatsapp';
import { generarLinkPagoWompi } from '@/lib/wompi';
import { formatearPrecioCOP } from '@/lib/shopify';
import { esRecogidaEnTienda, nombreSedeDesdeDireccion } from '@/lib/sedes';
import type { BotContext } from '@/types';

export async function POST(req: Request) {
  try {
    const body = await req.json();

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
              if (msgs?.length) {
                const m = msgs[0];
                await supabaseAdmin
                  .from('mensajes')
                  .update({ metadata: { ...m.metadata, estado_wa: estado } })
                  .eq('id', m.id);
              }
            }
            continue;
          }

          if (!change.value?.messages) continue;

          const message = change.value.messages[0];
          const contact = change.value.contacts?.[0];
          const rawPhone = message.from;
          const phone = formatearNumeroWhatsApp(rawPhone);
          const messageId = message.id;
          const msgType: string = message.type || 'text';

          if (messageId) await marcarComoLeido(messageId);

          const cliente = await buscarOCrearCliente(phone, contact?.profile?.name);
          const conversacion = await obtenerConversacionActiva(cliente.id);

          // Si el agente tomó control, solo guardar el mensaje — no responder con bot
          const { data: convData } = await supabaseAdmin
            .from('conversaciones')
            .select('bot_activo')
            .eq('id', conversacion.id)
            .single();
          const botActivo = convData?.bot_activo !== false; // default true si columna no existe aún

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
          const contexto: BotContext = { cliente, conversacion, mensajes_previos: historial };
          const respuesta = await procesarMensajeBot(texto, contexto);

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

              await guardarMensaje(conversacion.id, 'bot', msgLink, {
                tipo_wa: 'text',
                awaiting: 'link_enviado',
                referencia_pago: referencia,
                pending_cart: cart,
              });
              await enviarMensajeWhatsApp(phone, msgLink);

            } else {
              // Fallo al generar el link
              const msgError =
                `⚠️ Hubo un problema generando el link de pago. Por favor intenta de nuevo o escríbenos directamente.\n\n` +
                `Error: ${linkResult.error || 'Desconocido'}`;
              await guardarMensaje(conversacion.id, 'bot', msgError, { tipo_wa: 'text', awaiting: '' });
              await enviarMensajeWhatsApp(phone, msgError);
            }

            continue;
          }

          // ── Acción: transferir al asesor humano (Sofi no puede ayudar) ──
          if (respuesta.accion === 'transferir_a_asesor') {
            // Si hay un flujo activo (checkout, mayorista...), NO apagamos el bot:
            // apagarlo dejaba al cliente sin respuesta a mitad del proceso.
            const ultimoBotPrevio = [...historial].reverse().find((m) => m.tipo === 'bot');
            const flujoActivo = !!ultimoBotPrevio?.metadata?.awaiting;

            await guardarMensaje(conversacion.id, 'bot', respuesta.texto, {
              ...respuesta.metadata,
              tipo_wa: 'text',
              transferido_a_asesor: true,
            });
            await enviarMensajeWhatsApp(phone, respuesta.texto);

            if (!flujoActivo) {
              // Desactivar bot para que el agente tome el control
              await supabaseAdmin
                .from('conversaciones')
                .update({ bot_activo: false, updated_at: new Date().toISOString() })
                .eq('id', conversacion.id);
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
        }
      }
      return NextResponse.json({ success: true }, { status: 200 });
    }

    return NextResponse.json({ success: false }, { status: 400 });
  } catch (error) {
    console.error('WhatsApp webhook error:', error);
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
