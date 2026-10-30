// GET /api/cron/carrito-abandonado — Recordatorio de links de pago sin pagar
// (también lo ejecuta la tarea diaria /api/cron/diario)
import { NextResponse } from 'next/server';
import { mismoSecreto } from '@/lib/sesion';
import { recordarCarritosAbandonados } from '@/lib/recordatorios';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET || '';
  if (!secret || !mismoSecreto(req.headers.get('authorization') || '', `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json(await recordarCarritosAbandonados());
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
