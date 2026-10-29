// ============================================
// EVENTOS DEL SISTEMA — errores y avisos visibles en el CRM
// ============================================
//
// Antes los errores solo quedaban en los logs de Vercel: el día que se agotó
// el saldo de la IA nadie se enteró hasta que los clientes dejaron de recibir
// respuesta. Ahora cada falla importante queda registrada y el panel "Estado
// del sistema" del CRM la muestra.

import { supabaseAdmin } from './supabase';

export type NivelEvento = 'info' | 'aviso' | 'error';

/** Registra un evento. Nunca lanza error: si la tabla no existe, solo queda el log. */
export async function registrarEvento(
  nivel: NivelEvento,
  origen: string,
  mensaje: string,
  detalle?: Record<string, any>
): Promise<void> {
  const linea = `[${origen}] ${mensaje}`;
  if (nivel === 'error') console.error(linea, detalle ?? '');
  else if (nivel === 'aviso') console.warn(linea, detalle ?? '');
  else console.log(linea);

  try {
    await supabaseAdmin.from('eventos_sistema').insert({
      nivel,
      origen,
      mensaje: mensaje.slice(0, 500),
      detalle: detalle ?? null,
    });
  } catch {
    // Migración pendiente o base caída: el log de consola ya quedó
  }
}
