// ============================================
// TABLERO DE ATENCIÓN — cálculo de indicadores
// ============================================
//
// Función pura (sin base de datos) para poder probarla: recibe las filas del
// periodo y devuelve los indicadores que muestra el CRM.

export interface DatosTablero {
  desde: string;                 // ISO
  conversacionesNuevas: number;  // creadas en el periodo
  mensajes: Array<{ conversacion_id: string; tipo: 'user' | 'bot'; created_at: string; metadata: Record<string, any> | null }>;
  ventas: Array<{ referencia_pago: string | null; estado: string; total: number | null; created_at: string }>;
  encuestas: Array<{ asesor: string | null; asesor_nombre: string | null; calificacion: number; comentario: string | null; created_at: string }>;
  leads: Array<{ sede: string | null; created_at: string }>;
  pendientes: Array<{ pendiente_desde: string | null; updated_at: string }>;
}

const MOTIVOS: Record<string, string> = {
  cliente_pidio_asesor: 'Pidió un asesor',
  mayorista: 'Compra al por mayor',
  pago: 'Ayuda con el pago',
  frustracion: 'Cliente molesto',
  sofi: 'Sofi no pudo resolver',
  otro: 'Sin motivo registrado',
};

const diaColombia = (iso: string) => new Date(new Date(iso).getTime() - 5 * 3_600_000).toISOString().slice(0, 10);

function percentil(valores: number[], p: number): number | null {
  if (!valores.length) return null;
  const orden = [...valores].sort((a, b) => a - b);
  const i = Math.min(orden.length - 1, Math.max(0, Math.ceil((p / 100) * orden.length) - 1));
  return orden[i];
}

export function calcularTablero(d: DatosTablero, ahora = new Date()) {
  const porConv = new Map<string, DatosTablero['mensajes']>();
  for (const m of [...d.mensajes].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (!porConv.has(m.conversacion_id)) porConv.set(m.conversacion_id, []);
    porConv.get(m.conversacion_id)!.push(m);
  }
  const esAgente = (m: DatosTablero['mensajes'][number]) => m.tipo === 'bot' && m.metadata?.enviado_por === 'agente';
  const esTransferencia = (m: DatosTablero['mensajes'][number]) => m.tipo === 'bot' && !!m.metadata?.transferido_a_asesor;

  // Conversaciones con al menos un mensaje del cliente en el periodo
  const activas = Array.from(porConv.entries()).filter(([, ms]) => ms.some((m) => m.tipo === 'user'));
  const conPersona = activas.filter(([, ms]) => ms.some((m) => esAgente(m) || esTransferencia(m)));

  // Transferencias, motivo y tiempo hasta que respondió un asesor
  const motivos: Record<string, number> = {};
  const tiempos: number[] = [];
  const tiemposPorAsesor = new Map<string, number[]>();
  let sinRespuesta = 0;
  for (const [, ms] of porConv) {
    ms.forEach((m, i) => {
      if (!esTransferencia(m)) return;
      const motivo = m.metadata?.motivo_transferencia || (m.metadata?.derivacion === 'mayorista' ? 'mayorista' : 'otro');
      motivos[motivo] = (motivos[motivo] || 0) + 1;
      const respuesta = ms.slice(i + 1).find(esAgente);
      if (!respuesta) { sinRespuesta++; return; }
      const min = (new Date(respuesta.created_at).getTime() - new Date(m.created_at).getTime()) / 60000;
      tiempos.push(min);
      const asesor = respuesta.metadata?.asesor_nombre || respuesta.metadata?.asesor || 'Sin registrar';
      if (!tiemposPorAsesor.has(asesor)) tiemposPorAsesor.set(asesor, []);
      tiemposPorAsesor.get(asesor)!.push(min);
    });
  }
  const totalTransferencias = Object.values(motivos).reduce((s, n) => s + n, 0);

  // Desempeño por asesor
  const asesores = new Map<string, { nombre: string; mensajes: number; conversaciones: Set<string>; encuestas: number[] }>();
  const fila = (clave: string, nombre: string) => {
    if (!asesores.has(clave)) asesores.set(clave, { nombre, mensajes: 0, conversaciones: new Set(), encuestas: [] });
    return asesores.get(clave)!;
  };
  for (const m of d.mensajes) {
    if (!esAgente(m)) continue;
    const nombre = m.metadata?.asesor_nombre || m.metadata?.asesor || 'Sin registrar';
    const a = fila(nombre, nombre);
    a.mensajes++;
    a.conversaciones.add(m.conversacion_id);
  }
  for (const e of d.encuestas) fila(e.asesor_nombre || e.asesor || 'Sin registrar', e.asesor_nombre || e.asesor || 'Sin registrar').encuestas.push(e.calificacion);

  // Links de pago del bot: una referencia = un link (puede tener varias líneas)
  const links = new Map<string, { pagado: boolean; total: number }>();
  for (const v of d.ventas) {
    const ref = v.referencia_pago || `${v.created_at}`;
    const l = links.get(ref) || { pagado: false, total: 0 };
    l.total += Number(v.total || 0);
    if (v.estado === 'pagado') l.pagado = true;
    links.set(ref, l);
  }
  const linksPagados = Array.from(links.values()).filter((l) => l.pagado);

  // Encuestas
  const cuenta = (n: number) => d.encuestas.filter((e) => e.calificacion === n).length;
  const satisfechos = cuenta(3) + cuenta(2);

  // Serie diaria: conversaciones con mensajes del cliente y mensajes recibidos
  const dias: Record<string, { conversaciones: Set<string>; mensajes: number }> = {};
  const inicio = new Date(diaColombia(d.desde) + 'T12:00:00Z');
  for (let t = inicio.getTime(); diaColombia(new Date(t).toISOString()) <= diaColombia(ahora.toISOString()); t += 86_400_000) {
    dias[diaColombia(new Date(t).toISOString())] = { conversaciones: new Set(), mensajes: 0 };
  }
  for (const m of d.mensajes) {
    if (m.tipo !== 'user') continue;
    const k = diaColombia(m.created_at);
    if (!dias[k]) continue;
    dias[k].conversaciones.add(m.conversacion_id);
    dias[k].mensajes++;
  }

  const esperas = d.pendientes.map((p) => (ahora.getTime() - new Date(p.pendiente_desde || p.updated_at).getTime()) / 60000);

  return {
    resumen: {
      conversaciones_activas: activas.length,
      conversaciones_nuevas: d.conversacionesNuevas,
      mensajes_clientes: d.mensajes.filter((m) => m.tipo === 'user').length,
      resueltas_por_bot: activas.length - conPersona.length,
      porcentaje_bot: activas.length ? Math.round(((activas.length - conPersona.length) / activas.length) * 100) : null,
      transferencias: totalTransferencias,
      primera_respuesta_mediana_min: percentil(tiempos, 50),
      primera_respuesta_p90_min: percentil(tiempos, 90),
      transferencias_sin_respuesta: sinRespuesta,
      links_generados: links.size,
      links_pagados: linksPagados.length,
      conversion_links: links.size ? Math.round((linksPagados.length / links.size) * 100) : null,
      valor_pagado: linksPagados.reduce((s, l) => s + l.total, 0),
      encuestas: d.encuestas.length,
      satisfaccion: d.encuestas.length ? Math.round((satisfechos / d.encuestas.length) * 100) : null,
      pendientes_ahora: d.pendientes.length,
      espera_mas_larga_min: esperas.length ? Math.max(...esperas) : null,
    },
    motivos: Object.entries(motivos)
      .map(([clave, cantidad]) => ({ clave, motivo: MOTIVOS[clave] || clave, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad),
    encuestas: {
      excelente: cuenta(3), buena: cuenta(2), mala: cuenta(1),
      comentarios: d.encuestas.filter((e) => e.comentario).slice(-5).reverse()
        .map((e) => ({ comentario: e.comentario!, asesor: e.asesor_nombre || e.asesor, fecha: e.created_at })),
    },
    asesores: Array.from(asesores.entries()).map(([clave, a]) => ({
      asesor: a.nombre,
      conversaciones: a.conversaciones.size,
      mensajes: a.mensajes,
      primera_respuesta_mediana_min: percentil(tiemposPorAsesor.get(clave) || [], 50),
      encuestas: a.encuestas.length,
      satisfaccion: a.encuestas.length ? Math.round((a.encuestas.filter((n) => n >= 2).length / a.encuestas.length) * 100) : null,
    })).sort((a, b) => b.conversaciones - a.conversaciones),
    leads: Object.entries(d.leads.reduce<Record<string, number>>((m, l) => {
      const sede = l.sede || 'Sin sede';
      m[sede] = (m[sede] || 0) + 1;
      return m;
    }, {})).map(([sede, cantidad]) => ({ sede, cantidad })).sort((a, b) => b.cantidad - a.cantidad),
    serie: Object.entries(dias).map(([dia, v]) => ({ dia, conversaciones: v.conversaciones.size, mensajes: v.mensajes })),
  };
}

export type Tablero = ReturnType<typeof calcularTablero>;
