// POST /api/cron/recuperar-carritos
// Envía WhatsApp de recuperación a carritos abandonados > 20 minutos
// Llamar desde el frontend cada 60s o desde Vercel Cron
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { notificarCarritoAbandonado } from '@/lib/notificaciones';

export async function POST() {
  try {
    const ahora = new Date();
    const corte20min = new Date(ahora.getTime() - 20 * 60 * 1000).toISOString();

    // Marcar como abandonado los que llevan > 20 min en en_progreso
    await supabaseAdmin
      .from('carritos_abandonados')
      .update({ estado: 'abandonado', updated_at: ahora.toISOString() })
      .eq('estado', 'en_progreso')
      .lt('shopify_updated_at', corte20min);

    // Buscar carritos abandonados con teléfono, sin notificar
    const { data: carritos, error } = await supabaseAdmin
      .from('carritos_abandonados')
      .select('*')
      .eq('estado', 'abandonado')
      .eq('notificado_whatsapp', false)
      .not('telefono', 'is', null)
      .lt('shopify_updated_at', corte20min)
      .limit(20); // procesar de a 20 por vez

    if (error) throw error;
    if (!carritos || carritos.length === 0) {
      return NextResponse.json({ success: true, procesados: 0, message: 'Sin carritos pendientes' });
    }

    let enviados = 0;
    let fallidos = 0;

    for (const carrito of carritos) {
      try {
        const resultado = await notificarCarritoAbandonado({
          id: carrito.id,
          shopify_checkout_id: carrito.shopify_checkout_id,
          nombre: carrito.nombre,
          telefono: carrito.telefono,
          total: carrito.total || 0,
          url_checkout: carrito.url_checkout,
          items: carrito.items || [],
        });
        if (resultado.success) enviados++;
        else fallidos++;
      } catch {
        fallidos++;
      }
    }

    return NextResponse.json({ success: true, procesados: carritos.length, enviados, fallidos });
  } catch (error: any) {
    console.error('Error en cron recuperar-carritos:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// También permitir GET para facilitar pruebas
export async function GET() {
  return POST();
}
