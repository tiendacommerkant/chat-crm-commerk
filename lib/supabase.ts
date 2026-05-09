// ============================================
// SUPABASE CLIENT
// ============================================

import { createClient } from '@supabase/supabase-js';

// Cliente para uso en cliente (browser)
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder_key'
);

// Cliente para uso en servidor (con privilegios admin)
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || 'placeholder_key',
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// ──────────────────────────────────────────
// HELPERS DE BASE DE DATOS
// ──────────────────────────────────────────

import type {
  Cliente,
  Conversacion,
  Mensaje,
  Venta,
  Producto
} from '@/types';

/**
 * Buscar o crear un cliente por su número de teléfono
 */
export async function buscarOCrearCliente(telefono: string, nombre?: string): Promise<Cliente> {
  const { data: clienteExistente } = await supabaseAdmin
    .from('clientes')
    .select('*')
    .eq('telefono', telefono)
    .single();

  if (clienteExistente) {
    return clienteExistente;
  }

  const { data: nuevoCliente, error: errorCreacion } = await supabaseAdmin
    .from('clientes')
    .insert({
      telefono,
      nombre: nombre || null,
    })
    .select()
    .single();

  if (errorCreacion) {
    throw new Error(`Error creando cliente: ${errorCreacion.message}`);
  }

  return nuevoCliente!;
}

/**
 * Obtener o crear conversación activa para un cliente
 */
export async function obtenerConversacionActiva(clienteId: string): Promise<Conversacion> {
  const { data: conversacionExistente } = await supabaseAdmin
    .from('conversaciones')
    .select('*')
    .eq('cliente_id', clienteId)
    .eq('estado', 'activa')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (conversacionExistente) {
    return conversacionExistente;
  }

  const { data: nuevaConversacion, error } = await supabaseAdmin
    .from('conversaciones')
    .insert({
      cliente_id: clienteId,
      estado: 'activa',
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Error creando conversación: ${error.message}`);
  }

  return nuevaConversacion!;
}

/**
 * Guardar mensaje en la base de datos
 */
export async function guardarMensaje(
  conversacionId: string,
  tipo: 'user' | 'bot',
  contenido: string,
  metadata?: Record<string, any>
): Promise<Mensaje> {
  const { data, error } = await supabaseAdmin
    .from('mensajes')
    .insert({
      conversacion_id: conversacionId,
      tipo,
      contenido,
      metadata: metadata || null,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Error guardando mensaje: ${error.message}`);
  }

  return data!;
}

/**
 * Obtener historial de mensajes de una conversación
 */
export async function obtenerHistorialMensajes(
  conversacionId: string,
  limite: number = 50
): Promise<Mensaje[]> {
  const { data, error } = await supabaseAdmin
    .from('mensajes')
    .select('*')
    .eq('conversacion_id', conversacionId)
    .order('created_at', { ascending: false })
    .limit(limite);

  if (error) {
    throw new Error(`Error obteniendo mensajes: ${error.message}`);
  }

  return (data || []).reverse();
}

/**
 * Registrar una venta pendiente
 */
export async function registrarVentaPendiente(venta: {
  cliente_id: string;
  conversacion_id?: string;
  producto_shopify_id: string;
  producto_nombre: string;
  producto_precio: number;
  cantidad?: number;
  total?: number;
  link_pago: string;
  referencia_pago?: string;
  direccion_envio?: string;
}): Promise<Venta> {
  const cantidad = venta.cantidad || 1;
  const total = venta.total ?? venta.producto_precio * cantidad;

  const { data, error } = await supabaseAdmin
    .from('ventas')
    .insert({
      cliente_id: venta.cliente_id,
      conversacion_id: venta.conversacion_id,
      producto_shopify_id: venta.producto_shopify_id,
      producto_nombre: venta.producto_nombre,
      producto_precio: venta.producto_precio,
      cantidad,
      total,
      link_pago: venta.link_pago,
      referencia_pago: venta.referencia_pago,
      direccion_envio: venta.direccion_envio,
      estado: 'pendiente',
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Error registrando venta: ${error.message}`);
  }

  return data!;
}

/**
 * Actualizar estado de una venta
 */
export async function actualizarEstadoVenta(
  ventaId: string,
  estado: 'pendiente' | 'pagado' | 'cancelado',
  metadata?: Partial<Venta>
): Promise<Venta> {
  const { data, error } = await supabaseAdmin
    .from('ventas')
    .update({
      estado,
      ...metadata,
      updated_at: new Date().toISOString(),
    })
    .eq('id', ventaId)
    .select()
    .single();

  if (error) {
    throw new Error(`Error actualizando venta: ${error.message}`);
  }

  return data!;
}

/**
 * Obtener productos desde caché (Supabase)
 */
export async function obtenerProductosCache(): Promise<Producto[]> {
  const { data, error } = await supabaseAdmin
    .from('productos')
    .select('*')
    .eq('activo', true)
    .order('titulo', { ascending: true });

  if (error) {
    console.error('Error obteniendo productos:', error);
    return [];
  }

  return data || [];
}

/**
 * Sincronizar producto de Shopify a caché local
 */
export async function sincronizarProducto(producto: {
  shopify_id: string;
  titulo: string;
  descripcion?: string;
  precio: number;
  inventario: number;
  imagen_url?: string;
  categoria?: string;
  metadata?: Record<string, any>;
}): Promise<Producto> {
  const { data, error } = await supabaseAdmin
    .from('productos')
    .upsert({
      ...producto,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'shopify_id',
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Error sincronizando producto: ${error.message}`);
  }

  return data!;
}
