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
import type { BotContext } from '@/types';

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (body.object === 'whatsapp_business_account') {
      for (const entry of body.entry) {
        for (const change of entry.changes) {
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
            const msgAcuse = '¡Hola! Recibimos tu mensaje. ¿En qué te podemos ayudar? 😊\n\nEscribe *catálogo* para ver nuestros productos.';
            await guardarMensaje(conversacion.id, 'bot', msgAcuse, { tipo_wa: 'text' });
            await enviarMensajeWhatsApp(phone, msgAcuse);
            continue;
          }

          const historial = await obtenerHistorialMensajes(conversacion.id, 15);
          const contexto: BotContext = { cliente, conversacion, mensajes_previos: historial };
          const respuesta = await procesarMensajeBot(texto, contexto);

          // ── Acción: generar link de pago Wompi ─────────────────────────
          if (respuesta.accion === 'generar_link_pago' && respuesta.metadata) {
            const { producto, pending_cantidad, pending_direccion, pending_total, pending_costo_envio } = respuesta.metadata;
            const cantidad = pending_cantidad || 1;
            const direccion = pending_direccion || 'Sin especificar';
            const total = pending_total || (producto?.precio || 0) * cantidad;

            // Guardar mensaje "generando link..."
            await guardarMensaje(conversacion.id, 'bot', respuesta.texto, {
              ...respuesta.metadata,
              tipo_wa: 'text',
            });
            await enviarMensajeWhatsApp(phone, respuesta.texto);

            // Generar referencia única
            const referencia = `WA-${Date.now()}-${cliente.id.slice(0, 8)}`;

            // Crear link de pago en Wompi
            const linkResult = await generarLinkPagoWompi({
              nombre: `${producto.titulo} x${cantidad}`,
              descripcion: `Pedido WhatsApp — ${direccion}`,
              monto: total,
              referencia,
              urlRedireccion: `${process.env.NEXT_PUBLIC_BASE_URL}/pago/confirmacion?ref=${referencia}`,
            });

            if (linkResult.success && linkResult.link) {
              // Registrar venta pendiente en Supabase
              await registrarVentaPendiente({
                cliente_id: cliente.id,
                conversacion_id: conversacion.id,
                producto_shopify_id: producto.shopify_id,
                producto_nombre: producto.titulo,
                producto_precio: producto.precio,
                cantidad,
                total,
                link_pago: linkResult.link,
                referencia_pago: referencia,
                direccion_envio: direccion,
              });

              // Actualizar updated_at de la conversación
              await supabaseAdmin.from('conversaciones').update({ updated_at: new Date().toISOString() }).eq('id', conversacion.id);

              const msgLink =
                `🛒 *¡Tu pedido está listo para pagar!*\n\n` +
                `${producto.titulo} × ${cantidad}\n` +
                `💵 Total: *${formatearPrecioCOP(total)}*\n` +
                (pending_costo_envio === 0 ? `🎁 Envío: *GRATIS*\n` : `🚚 Envío incluido\n`) +
                `\n💳 *Paga de forma segura aquí:*\n${linkResult.link}\n\n` +
                `_El link es de un solo uso. Una vez confirmado el pago, procesamos tu pedido y te avisamos aquí._ ✅`;

              await guardarMensaje(conversacion.id, 'bot', msgLink, {
                tipo_wa: 'text',
                awaiting: 'link_enviado',
                referencia_pago: referencia,
                pending_product_id: producto.shopify_id,
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
