import { NextResponse } from 'next/server';
import { sincronizarCatalogo } from '@/lib/catalogo';
import { auditarRequest } from '@/lib/auditoria';

export const dynamic = 'force-dynamic';

// GET /api/shopify/sync → Sincroniza todos los productos de Shopify a Supabase
// y desactiva los que ya no están activos allá (botón "Sincronizar" del CRM).
// La tarea diaria (/api/cron/diario) hace lo mismo cada mañana.
export async function GET(req: Request) {
  try {
    const resultado = await sincronizarCatalogo();
    await auditarRequest(req, 'catalogo.sincronizar', 'catalogo', null, { sincronizados: resultado.sincronizados, desactivados: resultado.desactivados.length });
    return NextResponse.json({ success: true, ...resultado });
  } catch (error: any) {
    console.error('Error sincronizando Shopify:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Error interno' },
      { status: 500 }
    );
  }
}
