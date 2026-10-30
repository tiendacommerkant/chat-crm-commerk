// ============================================
// EMBUDO DE VENTAS EMPRESARIALES
// ============================================
// nueva → contactada → cotizada → ganada | perdida

import { supabaseAdmin } from './supabase';

export const ETAPAS = ['nueva', 'contactada', 'cotizada', 'ganada', 'perdida'] as const;
export type Etapa = typeof ETAPAS[number];

export const NOMBRE_ETAPA: Record<Etapa, string> = {
  nueva: 'Nueva',
  contactada: 'Contactada',
  cotizada: 'Cotizada',
  ganada: 'Ganada',
  perdida: 'Perdida',
};

/** Unidades mencionadas en el mensaje ("200 kits", "unas 50 botellas"); null si no hay. */
export function unidadesMencionadas(texto: string): number | null {
  const m = texto.match(/\b(\d{2,5})\s*(kits?|unidades|botellas|anchetas|cajas|regalos|personas|empleados|colaboradores|clientes)\b/i);
  return m ? Number(m[1]) : null;
}

/**
 * Crea la oportunidad de una conversación empresarial, o completa la que ya
 * está abierta (correo, necesidad, unidades). Nunca lanza error: si la tabla
 * no existe todavía, el flujo del bot sigue igual.
 */
export async function asegurarOportunidad(datos: {
  conversacionId: string;
  clienteId: string;
  contacto?: string | null;
  telefono?: string | null;
  correo?: string | null;
  necesidad?: string | null;
}): Promise<void> {
  try {
    const { data: abierta, error } = await supabaseAdmin
      .from('oportunidades')
      .select('id, correo, necesidad, unidades')
      .eq('conversacion_id', datos.conversacionId)
      .not('etapa', 'in', '(ganada,perdida)')
      .maybeSingle();
    if (error) return;

    const unidades = datos.necesidad ? unidadesMencionadas(datos.necesidad) : null;
    if (abierta) {
      const cambios: Record<string, any> = {};
      if (datos.correo && !abierta.correo) cambios.correo = datos.correo;
      if (datos.necesidad && !abierta.necesidad) cambios.necesidad = datos.necesidad.slice(0, 700);
      if (unidades && !abierta.unidades) cambios.unidades = unidades;
      if (Object.keys(cambios).length) {
        await supabaseAdmin.from('oportunidades').update({ ...cambios, updated_at: new Date().toISOString() }).eq('id', abierta.id);
      }
      return;
    }

    await supabaseAdmin.from('oportunidades').insert({
      conversacion_id: datos.conversacionId,
      cliente_id: datos.clienteId,
      contacto: datos.contacto || null,
      telefono: datos.telefono || null,
      correo: datos.correo || null,
      necesidad: datos.necesidad ? datos.necesidad.slice(0, 700) : null,
      unidades,
    });
  } catch {
    /* el embudo nunca frena la conversación */
  }
}
