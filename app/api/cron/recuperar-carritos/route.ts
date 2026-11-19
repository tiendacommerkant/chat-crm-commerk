// POST /api/cron/recuperar-carritos
// Trae de Shopify los carritos del último día y recuerda los abandonados por
// WhatsApp (reglas en lib/recuperacion.ts). La llaman la tarea programada de
// Supabase cada 10 minutos (Bearer CRON_SECRET) y el CRM abierto cada minuto.
//
// De paso pone en el bot el precio vigente en Colombia (lib/precios-mercado.ts):
// así cambia a los pocos minutos de que el lanzamiento de Black Friday encienda
// o apague el catálogo de oferta.
import { NextResponse } from 'next/server';
import { procesarCarritosPendientes } from '@/lib/recuperacion';
import { actualizarPreciosMercado } from '@/lib/precios-mercado';
import { registrarEvento } from '@/lib/eventos';
import { vigilarPagosTienda, sincronizarEstadosPedidos, marcarCarritosComprados } from '@/lib/vigilancia-tienda';
import { enviarDifusionesProgramadas } from '@/lib/difusiones';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Pagos de la tienda sin pedido en Shopify, estados de pedidos y carritos
 * comprados (lib/vigilancia-tienda.ts). Cada parte falla por su cuenta.
 */
async function vigilarTienda() {
  const parte = async <T,>(nombre: string, fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (e: any) {
      await registrarEvento('aviso', 'vigilancia', `No se pudo revisar ${nombre}: ${e.message}`);
      return { error: e.message };
    }
  };
  // Primero los estados de pedidos: los carritos se cruzan con ellos
  const pedidos = await parte('los estados de los pedidos', () => sincronizarEstadosPedidos());
  const [pagos, carritos] = await Promise.all([
    parte('los pagos de la tienda en Wompi', () => vigilarPagosTienda()),
    parte('los carritos comprados', () => marcarCarritosComprados()),
  ]);
  return { pagos, pedidos, carritos };
}

/** Difusiones programadas cuya hora llegó (ej. Black Week, 23 nov 8:00 a. m.). */
async function difusionesProgramadas() {
  try {
    return await enviarDifusionesProgramadas();
  } catch (e: any) {
    await registrarEvento('error', 'difusiones', `No se pudieron enviar las difusiones programadas: ${e.message}`);
    return { error: e.message };
  }
}

async function revisarPrecios() {
  try {
    const r = await actualizarPreciosMercado();
    if (r.actualizados.length) {
      await registrarEvento('info', 'catalogo', `Precios del bot actualizados al precio vigente en Colombia: ${r.actualizados.length} producto(s)`, { productos: r.actualizados.slice(0, 30) });
    }
    return { revisados: r.revisados, actualizados: r.actualizados.length };
  } catch (e: any) {
    await registrarEvento('aviso', 'catalogo', `No se pudieron revisar los precios de Colombia: ${e.message}`);
    return { error: e.message };
  }
}

export async function POST() {
  try {
    // Los precios y la vigilancia van aparte: si fallan, los carritos se procesan igual
    const [carritos, precios, tienda, difusiones] = await Promise.all([procesarCarritosPendientes(), revisarPrecios(), vigilarTienda(), difusionesProgramadas()]);
    return NextResponse.json({ success: true, ...carritos, precios, tienda, difusiones });
  } catch (error: any) {
    console.error('Error en cron recuperar-carritos:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// También permitir GET para facilitar pruebas
export async function GET() {
  return POST();
}
