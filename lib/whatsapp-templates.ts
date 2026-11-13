// ============================================
// WHATSAPP TEMPLATES — Plantillas aprobadas por Meta
// ============================================

import { registrarEnvioPlantilla } from './costos';
import { WHATSAPP_GRAPH_VERSION, destinatarioWhatsApp } from './whatsapp';
import { TIEMPO_ENTREGA } from './cobertura';

const WA_API = `https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
const TOKEN = process.env.WHATSAPP_ACCESS_TOKEN!;

async function enviarPlantilla(telefono: string, templateName: string, components: any[]): Promise<boolean> {
  const res = await fetch(WA_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      ...destinatarioWhatsApp(telefono),
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'es' },
        components,
      },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error(`[WA Template] Error ${templateName}:`, JSON.stringify(data));
  }
  // Registrar el envío para el panel de costos (no bloquea el flujo)
  registrarEnvioPlantilla(templateName, res.ok).catch(() => {});
  return res.ok;
}

/**
 * Plantilla de confirmación del pago. La anterior (confirmacion_pago) dice
 * "Lo despachamos en las próximas 24-48 horas" y el equipo pidió no prometer
 * menos de 3 a 5 días hábiles: esta lleva la entrega como campo.
 */
export const PLANTILLA_CONFIRMACION_PAGO = 'pago_confirmado';

/**
 * pago_confirmado — UTILITY
 * {{1}}=nombre, {{2}}=producto, {{3}}=total, {{4}}=entrega
 *   ("llega en 3 a 5 días hábiles; te avisamos por aquí cuando salga")
 * Si Meta todavía no la aprueba (o falla), sale la anterior para que el
 * cliente reciba su confirmación de todas formas.
 */
export async function enviarConfirmacionPago(
  telefono: string,
  nombre: string,
  producto: string,
  total: string,
  entrega = `llega en ${TIEMPO_ENTREGA}; te avisamos por aquí cuando salga`
): Promise<boolean> {
  const enviada = await enviarPlantilla(telefono, PLANTILLA_CONFIRMACION_PAGO, [
    {
      type: 'body',
      parameters: [nombre || 'Cliente', producto, total, entrega].map((text) => ({ type: 'text', text })),
    },
  ]);
  if (enviada) return true;
  return enviarPlantilla(telefono, 'confirmacion_pago', [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: nombre || 'Cliente' },
        { type: 'text', text: producto },
        { type: 'text', text: total },
      ],
    },
  ]);
}

/**
 * recordatorio_pago — UTILITY
 * {{1}}=nombre, {{2}}=producto, {{3}}=total, {{4}}=link_id
 * Botón URL dinámica: https://checkout.wompi.co/l/{{1}}
 */
export async function enviarRecordatorioPago(
  telefono: string,
  nombre: string,
  producto: string,
  total: string,
  linkId: string
): Promise<boolean> {
  return enviarPlantilla(telefono, 'recordatorio_pago', [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: nombre || 'Cliente' },
        { type: 'text', text: producto },
        { type: 'text', text: total },
        { type: 'text', text: `https://checkout.wompi.co/l/${linkId}` },
      ],
    },
    {
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: linkId }],
    },
  ]);
}

/**
 * pedido_en_camino — UTILITY
 * {{1}}=nombre, {{2}}=producto, {{3}}=dirección
 */
export async function enviarPedidoEnCamino(
  telefono: string,
  nombre: string,
  producto: string,
  direccion: string
): Promise<boolean> {
  return enviarPlantilla(telefono, 'pedido_en_camino', [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: nombre || 'Cliente' },
        { type: 'text', text: producto },
        { type: 'text', text: direccion },
      ],
    },
  ]);
}

/**
 * pedido_recoger_sede — UTILITY
 * Aviso a la tienda física cuando un cliente paga para recoger en sede.
 * {{1}}=sede, {{2}}=cliente, {{3}}=tel cliente, {{4}}=productos, {{5}}=total, {{6}}=pedido
 */
export async function enviarPedidoRecogerSede(
  telefonoSede: string,
  sede: string,
  cliente: string,
  telCliente: string,
  productos: string,
  total: string,
  pedido: string
): Promise<boolean> {
  return enviarPlantilla(telefonoSede, 'pedido_recoger_sede', [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: sede || 'Tienda' },
        { type: 'text', text: cliente || 'Cliente' },
        { type: 'text', text: telCliente || 'N/D' },
        { type: 'text', text: productos || 'Pedido' },
        { type: 'text', text: total || '—' },
        { type: 'text', text: pedido || 'Pendiente' },
      ],
    },
  ]);
}

/**
 * lead_mayorista — UTILITY
 * Aviso a la sede cuando un cliente pide compra al por mayor.
 * {{1}}=sede, {{2}}=cliente, {{3}}=tel cliente, {{4}}=consulta
 */
export async function enviarLeadMayorista(
  telefonoSede: string,
  sede: string,
  cliente: string,
  telCliente: string,
  consulta: string
): Promise<boolean> {
  return enviarPlantilla(telefonoSede, 'lead_mayorista', [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: sede || 'Tienda' },
        { type: 'text', text: cliente || 'Cliente' },
        { type: 'text', text: telCliente || 'N/D' },
        { type: 'text', text: consulta || 'Compra al por mayor' },
      ],
    },
  ]);
}

/**
 * carrito_abandonado — MARKETING
 * {{1}}=nombre, {{2}}=producto, {{3}}=precio
 * Botones: "Completar compra", "No me interesa"
 */
export async function enviarCarritoAbandonado(
  telefono: string,
  nombre: string,
  producto: string,
  precio: string
): Promise<boolean> {
  return enviarPlantilla(telefono, 'carrito_abandonado', [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: nombre || 'Cliente' },
        { type: 'text', text: producto },
        { type: 'text', text: precio },
      ],
    },
  ]);
}
