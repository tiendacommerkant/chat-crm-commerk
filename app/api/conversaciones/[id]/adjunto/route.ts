// POST /api/conversaciones/[id]/adjunto — El asesor envía una foto o un PDF
// (multipart: archivo + texto opcional que va como pie de foto)
import { NextResponse } from 'next/server';
import { ARCHIVOS_PERMITIDOS, subirArchivoWhatsApp, enviarArchivoWhatsApp } from '@/lib/whatsapp';
import { asesorDeRequest } from '@/lib/sesion';
import { obtenerDestino, registrarMensajeAsesor, traducirErrorWhatsApp } from '@/lib/chat-asesor';
import { auditarRequest } from '@/lib/auditoria';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const asesor = await asesorDeRequest(req);
    if (!asesor) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });

    const form = await req.formData();
    const archivo = form.get('archivo');
    const texto = String(form.get('texto') || '').trim();
    if (!(archivo instanceof File)) {
      return NextResponse.json({ success: false, error: 'Falta el archivo' }, { status: 400 });
    }

    const permitido = ARCHIVOS_PERMITIDOS[archivo.type];
    if (!permitido) {
      return NextResponse.json({ success: false, error: 'Solo se pueden enviar fotos JPG o PNG y documentos PDF.' }, { status: 400 });
    }
    if (archivo.size > permitido.maxBytes) {
      const mb = Math.round(permitido.maxBytes / 1024 / 1024);
      return NextResponse.json({ success: false, error: `El archivo supera el límite de WhatsApp (${mb} MB).` }, { status: 400 });
    }

    const destino = await obtenerDestino(params.id);
    if (!destino) {
      return NextResponse.json({ success: false, error: 'Conversación no encontrada o cliente sin teléfono' }, { status: 404 });
    }

    const nombreArchivo = archivo.name || (permitido.tipo === 'document' ? 'documento.pdf' : 'foto.jpg');
    const subida = await subirArchivoWhatsApp(await archivo.arrayBuffer(), archivo.type, nombreArchivo);
    if (!subida.id) {
      return NextResponse.json({ success: false, error: `No se pudo subir el archivo: ${subida.error}` }, { status: 502 });
    }

    const envio = await enviarArchivoWhatsApp(destino.telefono, permitido.tipo, subida.id, {
      caption: texto || undefined,
      filename: permitido.tipo === 'document' ? nombreArchivo : undefined,
    });
    if (!envio.success) {
      return NextResponse.json({ success: false, error: traducirErrorWhatsApp(envio.error) }, { status: 502 });
    }

    const contenido = texto || (permitido.tipo === 'image' ? '📷 Imagen' : `📄 ${nombreArchivo}`);
    const mensaje = await registrarMensajeAsesor(destino, contenido, {
      tipo_wa: permitido.tipo,
      media_id: subida.id,
      media_url: `/api/wa-media/${subida.id}`,
      media_mime_type: archivo.type,
      filename: nombreArchivo,
      caption: texto || '',
      whatsapp_message_id: envio.messageId,
    }, asesor);

    await auditarRequest(req, 'mensaje.adjunto', 'conversacion', params.id, { archivo: nombreArchivo });
    return NextResponse.json({ success: true, mensaje });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
