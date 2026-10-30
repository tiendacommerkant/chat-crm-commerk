// POST /api/cron/recuperar-carritos
// Trae de Shopify los carritos del último día y recuerda los abandonados por
// WhatsApp (reglas en lib/recuperacion.ts). La llaman la tarea programada de
// Supabase cada 10 minutos (Bearer CRON_SECRET) y el CRM abierto cada minuto.
import { NextResponse } from 'next/server';
import { procesarCarritosPendientes } from '@/lib/recuperacion';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST() {
  try {
    return NextResponse.json({ success: true, ...(await procesarCarritosPendientes()) });
  } catch (error: any) {
    console.error('Error en cron recuperar-carritos:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// También permitir GET para facilitar pruebas
export async function GET() {
  return POST();
}
