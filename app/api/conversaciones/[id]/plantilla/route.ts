// POST /api/conversaciones/[id]/plantilla — El asesor envía una plantilla aprobada
// Es la única forma de escribirle a un cliente pasadas 24 h de su último mensaje.
// Body: { nombre, idioma, parametros: string[], parametroBoton?: string, texto }
//   parametros     → valores de {{1}}, {{2}}… del cuerpo, en orden
//   parametroBoton → valor del botón con URL dinámica, si la plantilla lo tiene
//   texto          → cuerpo ya armado, para mostrarlo en el CRM
import { NextResponse } from 'next/server';
import { enviarPlantillaWhatsApp } from '@/lib/whatsapp';
import { registrarEnvioPlantilla } from '@/lib/costos';
import { asesorDeRequest } from '@/lib/sesion';
import { obtenerDestino, registrarMensajeAsesor, traducirErrorWhatsApp } from '@/lib/chat-asesor';
import { auditarRequest } from '@/lib/auditoria';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const asesor = await asesorDeRequest(req);
    if (!asesor) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });

    const { nombre, idioma, parametros, parametroBoton, texto } = await req.json().catch(() => ({}));
    if (!nombre || typeof nombre !== 'string') {
      return NextResponse.json({ success: false, error: 'Falta la plantilla' }, { status: 400 });
    }
    const valores: string[] = Array.isArray(parametros) ? parametros.map((p) => String(p ?? '').trim()) : [];
    if (valores.some((v) => !v)) {
      return NextResponse.json({ success: false, error: 'Completa todos los campos de la plantilla' }, { status: 400 });
    }

    const destino = await obtenerDestino(params.id);
    if (!destino) {
      return NextResponse.json({ success: false, error: 'Conversación no encontrada o cliente sin teléfono' }, { status: 404 });
    }

    const components: any[] = [];
    if (valores.length) {
      components.push({ type: 'body', parameters: valores.map((v) => ({ type: 'text', text: v })) });
    }
    if (parametroBoton) {
      components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: String(parametroBoton) }] });
    }

    const envio = await enviarPlantillaWhatsApp(destino.telefono, nombre, typeof idioma === 'string' && idioma ? idioma : 'es', components);
    registrarEnvioPlantilla(nombre, envio.success).catch(() => {});
    if (!envio.success) {
      return NextResponse.json({ success: false, error: traducirErrorWhatsApp(envio.error) }, { status: 502 });
    }

    const mensaje = await registrarMensajeAsesor(destino, typeof texto === 'string' && texto ? texto : `Plantilla ${nombre}`, {
      tipo_wa: 'template',
      plantilla: nombre,
      estado_envio: 'enviado',
      whatsapp_message_id: envio.messageId,
    }, asesor);

    await auditarRequest(req, 'mensaje.plantilla', 'conversacion', params.id, { plantilla: nombre });
    return NextResponse.json({ success: true, mensaje });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
