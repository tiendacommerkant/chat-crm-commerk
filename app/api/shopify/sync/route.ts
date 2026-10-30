import { NextResponse } from 'next/server';
import { sincronizarCatalogo } from '@/lib/catalogo';

export const dynamic = 'force-dynamic';

// GET /api/shopify/sync → Sincroniza todos los productos de Shopify a Supabase
// y desactiva los que ya no están activos allá (botón "Sincronizar" del CRM).
// La tarea diaria (/api/cron/diario) hace lo mismo cada mañana.
export async function GET() {
  try {
    const resultado = await sincronizarCatalogo();
    return NextResponse.json({ success: true, ...resultado });
  } catch (error: any) {
    console.error('Error sincronizando Shopify:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Error interno' },
      { status: 500 }
    );
  }
}
