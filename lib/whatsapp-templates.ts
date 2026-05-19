// ============================================
// WHATSAPP TEMPLATES — Plantillas aprobadas por Meta
// ============================================

const WA_API = `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
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
      to: telefono,
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
  return res.ok;
}

/**
 * confirmacion_pago — UTILITY
 * {{1}}=nombre, {{2}}=producto, {{3}}=total
 */
export async function enviarConfirmacionPago(
  telefono: string,
  nombre: string,
  producto: string,
  total: string
): Promise<boolean> {
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
