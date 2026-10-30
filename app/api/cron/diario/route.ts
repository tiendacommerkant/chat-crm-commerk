// GET /api/cron/diario — Tarea de cada mañana (Vercel Cron, 10:00 a. m. Colombia)
//   1. Sincroniza el catálogo con Shopify (precios, existencias, productos inactivos)
//   2. Trae de Shopify los carritos abandonados de los últimos 2 días y
//      recuerda los del último día (respaldo de la tarea de cada 10 minutos)
//   3. Envía los recordatorios de links de pago sin pagar (uno por cliente)
// Cada paso es independiente: si uno falla, los demás siguen y queda el error
// en el panel "Estado del sistema".
import { NextResponse } from 'next/server';
import { mismoSecreto } from '@/lib/sesion';
import { sincronizarCatalogo } from '@/lib/catalogo';
import { sincronizarCarritosShopify } from '@/lib/carritos';
import { procesarCarritosPendientes } from '@/lib/recuperacion';
import { recordarCarritosAbandonados } from '@/lib/recordatorios';
import { registrarEvento } from '@/lib/eventos';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function paso<T>(nombre: string, fn: () => Promise<T>): Promise<{ ok: boolean; resultado?: T; error?: string }> {
  try {
    return { ok: true, resultado: await fn() };
  } catch (e: any) {
    await registrarEvento('error', 'tarea-diaria', `${nombre}: ${e?.message || e}`);
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function GET(req: Request) {
  const inicio = Date.now();
  const secret = process.env.CRON_SECRET || '';
  if (!secret || !mismoSecreto(req.headers.get('authorization') || '', `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const catalogo = await paso('Catálogo', sincronizarCatalogo);
  const carritos = await paso('Carritos de Shopify', async () => ({
    sincronizados: await sincronizarCarritosShopify(48),
    // La función tiene 60 s: lo que no alcance lo sigue la siguiente revisión
    recuperacion: await procesarCarritosPendientes(inicio + 50_000),
  }));
  const recordatorios = await paso('Recordatorios de carrito', recordarCarritosAbandonados);

  const c = catalogo.resultado;
  await registrarEvento('info', 'tarea-diaria',
    `Catálogo: ${c ? `${c.sincronizados} productos${c.desactivados.length ? `, ${c.desactivados.length} desactivados` : ''}` : 'falló'} · ` +
    `Recordatorios: ${recordatorios.resultado ? `${recordatorios.resultado.enviados} enviados` : 'falló'}`);

  return NextResponse.json({
    catalogo: c ? { ok: true, sincronizados: c.sincronizados, desactivados: c.desactivados } : catalogo,
    carritos,
    recordatorios,
  });
}
