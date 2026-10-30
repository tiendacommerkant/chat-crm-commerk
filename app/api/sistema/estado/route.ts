// GET /api/sistema/estado — Revisión en vivo de cada pieza del sistema
// (WhatsApp, IA, Shopify, Wompi, base de datos, migraciones y captura de
// carritos) más los últimos errores registrados.
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { WHATSAPP_GRAPH_VERSION } from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';

interface Chequeo { servicio: string; ok: boolean; detalle: string; nivel?: 'ok' | 'aviso' | 'error' }

const TIMEOUT = 6000;

async function revisar(servicio: string, fn: () => Promise<Omit<Chequeo, 'servicio'>>): Promise<Chequeo> {
  try {
    return { servicio, ...(await fn()) };
  } catch (e: any) {
    return { servicio, ok: false, nivel: 'error', detalle: e?.name === 'TimeoutError' ? 'No respondió a tiempo' : e?.message || 'Error' };
  }
}

export async function GET() {
  const hace2h = new Date(Date.now() - 2 * 3600e3).toISOString();

  const chequeos = await Promise.all([
    revisar('WhatsApp', async () => {
      const r = await fetch(
        `https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}?fields=display_phone_number,verified_name,quality_rating`,
        { headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` }, signal: AbortSignal.timeout(TIMEOUT), cache: 'no-store' }
      );
      const d = await r.json();
      if (!r.ok) return { ok: false, nivel: 'error', detalle: d?.error?.message || `HTTP ${r.status}` };
      const calidad = d.quality_rating === 'GREEN' ? 'alta' : d.quality_rating === 'YELLOW' ? 'media' : d.quality_rating === 'RED' ? 'baja' : d.quality_rating || '—';
      return { ok: true, nivel: d.quality_rating === 'RED' ? 'aviso' : 'ok', detalle: `${d.verified_name || ''} ${d.display_phone_number || ''} · calidad ${calidad}`.trim() };
    }),
    revisar('Asistente IA', async () => {
      const r = await fetch('https://api.anthropic.com/v1/models?limit=1', {
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY || '', 'anthropic-version': '2023-06-01' },
        signal: AbortSignal.timeout(TIMEOUT), cache: 'no-store',
      });
      if (!r.ok) return { ok: false, nivel: 'error', detalle: r.status === 401 ? 'La llave de la IA no es válida' : `HTTP ${r.status}` };
      // El límite de gasto solo se nota al responder: se revisan los errores recientes
      const { data: errores } = await supabaseAdmin.from('eventos_sistema').select('mensaje, created_at')
        .eq('origen', 'sofi').eq('nivel', 'error').gte('created_at', hace2h).order('created_at', { ascending: false }).limit(1);
      if (errores?.length) return { ok: false, nivel: 'error', detalle: `Falló al responder: ${errores[0].mensaje}` };
      return { ok: true, nivel: 'ok', detalle: 'Llave válida, sin errores en las últimas 2 horas' };
    }),
    revisar('Shopify', async () => {
      const r = await fetch(`https://${process.env.SHOPIFY_STORE}.myshopify.com/admin/api/2024-01/shop.json`, {
        headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN || '' }, signal: AbortSignal.timeout(TIMEOUT), cache: 'no-store',
      });
      if (!r.ok) return { ok: false, nivel: 'error', detalle: `HTTP ${r.status}` };
      const d = await r.json();
      return { ok: true, nivel: 'ok', detalle: `${d.shop?.name || 'Tienda'} · plan ${d.shop?.plan_display_name || ''}`.trim() };
    }),
    revisar('Pagos Wompi', async () => {
      // Consulta inofensiva con la llave privada (la que crea los links de pago)
      const llave = process.env.WOMPI_PRIVATE_KEY || '';
      const pruebas = llave.startsWith('prv_test');
      const base = pruebas ? 'https://sandbox.wompi.co' : 'https://production.wompi.co';
      const r = await fetch(`${base}/v1/transactions?reference=revision-estado-crm`, {
        headers: { Authorization: `Bearer ${llave}` }, signal: AbortSignal.timeout(TIMEOUT), cache: 'no-store',
      });
      if (r.status === 401) return { ok: false, nivel: 'error', detalle: 'La llave privada de Wompi no es válida: no se pueden crear links de pago' };
      if (!r.ok) return { ok: false, nivel: 'error', detalle: `Wompi respondió HTTP ${r.status}` };
      return { ok: true, nivel: 'ok', detalle: pruebas ? 'Conectado en modo pruebas' : 'Conectado: se pueden crear links de pago' };
    }),
    revisar('Base de datos', async () => {
      const { error } = await supabaseAdmin.from('conversaciones').select('estado_atencion').limit(1);
      if (error && /estado_atencion/.test(error.message)) {
        return { ok: false, nivel: 'aviso', detalle: 'Falta correr la migración de atención (sql/migracion_2026_10_atencion_profesional.sql)' };
      }
      if (error) return { ok: false, nivel: 'error', detalle: error.message };
      // Con la anon key (pública) nadie debería poder leer clientes
      const anon = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/clientes?select=id&limit=1`, {
        headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '', Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''}` },
        signal: AbortSignal.timeout(TIMEOUT), cache: 'no-store',
      });
      const filas = anon.ok ? await anon.json() : [];
      if (Array.isArray(filas) && filas.length) {
        return { ok: false, nivel: 'aviso', detalle: 'La llave pública todavía lee datos de clientes: falta correr sql/migracion_2026_10_seguridad_rls.sql' };
      }
      return { ok: true, nivel: 'ok', detalle: 'Conectada y protegida' };
    }),
    revisar('Firma de Meta', async () =>
      process.env.WHATSAPP_APP_SECRET
        ? { ok: true, nivel: 'ok', detalle: 'Los mensajes entrantes se verifican' }
        : { ok: false, nivel: 'aviso', detalle: 'Falta WHATSAPP_APP_SECRET en Vercel: no se verifica que los mensajes vengan de Meta' }
    ),
    revisar('Carritos abandonados', async () => {
      const { data } = await supabaseAdmin.from('carritos_abandonados').select('created_at').order('created_at', { ascending: false }).limit(1);
      const ultimo = data?.[0]?.created_at;
      if (!ultimo) return { ok: false, nivel: 'aviso', detalle: 'Aún no hay carritos registrados' };
      const dias = Math.floor((Date.now() - new Date(ultimo).getTime()) / 86400e3);
      // ¿Shopify manda los avisos de checkout o solo entran por la sincronización?
      const { data: avisos } = await supabaseAdmin.from('configuracion').select('valor').eq('clave', 'shopify_avisos').maybeSingle();
      const ultimoAviso = ['checkouts/create', 'checkouts/update'].map((t) => (avisos as any)?.valor?.[t]).filter(Boolean).sort().pop();
      const viaAviso = ultimoAviso
        ? ` · último aviso de checkout de Shopify ${new Date(ultimoAviso).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`
        : ' · llegan por la sincronización cada 10 min (Shopify no ha enviado avisos de checkout)';
      return dias > 3
        ? { ok: false, nivel: 'aviso', detalle: `El último carrito registrado es de hace ${dias} días${viaAviso}` }
        : { ok: true, nivel: 'ok', detalle: `Último carrito registrado hace ${dias === 0 ? 'menos de un día' : `${dias} día(s)`}${viaAviso}` };
    }),
  ]);

  const { data: eventos } = await supabaseAdmin.from('eventos_sistema')
    .select('nivel, origen, mensaje, created_at').order('created_at', { ascending: false }).limit(15);

  return NextResponse.json({
    success: true,
    revisado: new Date().toISOString(),
    todo_ok: chequeos.every((c) => c.ok),
    chequeos,
    eventos: eventos || [],
  });
}
