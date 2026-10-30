// Piezas para simular conversaciones con el bot sin base de datos ni red
import type { BotContext } from '@/types';
import productosReales from '../fixtures/productos.json';

export const productos = productosReales as any[];

/** Busca un producto del catálogo de prueba por parte del título. */
export function producto(parteTitulo: string): any {
  const p = productos.find((x) => x.titulo.toLowerCase().includes(parteTitulo.toLowerCase()));
  if (!p) throw new Error(`No hay producto que contenga "${parteTitulo}" en el catálogo de prueba`);
  return p;
}

/**
 * Cliente de Supabase falso: cualquier consulta encadenada responde "sin
 * datos" (o lo que diga `datos` para esa tabla) y queda registrada, para
 * revisar qué intentó guardar el código.
 */
export function crearSupabaseFalso(
  registro: Array<{ tabla: string; op: string; args: any[] }>,
  datos: Record<string, any> = {}
) {
  const consulta = (tabla: string): any => {
    const q: any = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === 'then') {
          return (ok: any, error: any) => Promise.resolve({ data: datos[tabla] ?? null, error: null, count: 0 }).then(ok, error);
        }
        return (...args: any[]) => {
          registro.push({ tabla, op: prop, args });
          return q;
        };
      },
    });
    return q;
  };
  return { from: (tabla: string) => consulta(tabla), rpc: async () => ({ data: null, error: null }) };
}

let contador = 0;
const id = () => `id-${++contador}`;

/** Mensaje previo del bot con su estado (lo que el motor lee para continuar). */
export function bot(texto: string, metadata: Record<string, any> = {}, horasAtras = 0) {
  return {
    id: id(), conversacion_id: 'conv-1', tipo: 'bot' as const, contenido: texto, metadata,
    created_at: new Date(Date.now() - horasAtras * 3_600_000 - 1000).toISOString(),
  };
}

export function cliente(texto: string, horasAtras = 0) {
  return {
    id: id(), conversacion_id: 'conv-1', tipo: 'user' as const, contenido: texto, metadata: {},
    created_at: new Date(Date.now() - horasAtras * 3_600_000 - 2000).toISOString(),
  };
}

/** Contexto de una conversación. Por defecto: cliente registrado con sede Virtual. */
export function contexto(opciones: {
  historial?: any[];
  politicas?: boolean;
  sede?: string | null;
  nombre?: string;
  telefono?: string;
  etiqueta?: string | null;
} = {}): BotContext {
  return {
    cliente: {
      id: 'cliente-1',
      telefono: opciones.telefono ?? '573001234567',
      nombre: opciones.nombre ?? 'Laura Gómez',
      politicas_aceptadas: opciones.politicas ?? true,
      sede_preferida: opciones.sede === undefined ? 'Virtual' : opciones.sede,
    } as any,
    conversacion: { id: 'conv-1', cliente_id: 'cliente-1', estado: 'activa', etiqueta: opciones.etiqueta ?? null } as any,
    mensajes_previos: (opciones.historial || []) as any,
  };
}
