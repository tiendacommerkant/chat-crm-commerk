// ============================================
// TIPOS Y INTERFACES DEL SISTEMA
// ============================================

// ──────────────────────────────────────────
// BASE DE DATOS (Supabase)
// ──────────────────────────────────────────

export interface Cliente {
  id: string;
  telefono: string;
  nombre?: string | null;
  email?: string | null;
  ciudad?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface Conversacion {
  id: string;
  cliente_id: string;
  estado: 'activa' | 'cerrada' | 'abandonada';
  ultima_actividad?: string;
  created_at: string;
  updated_at: string;
  
  // Relaciones
  cliente?: Cliente;
  mensajes?: Mensaje[];
}

export interface Mensaje {
  id: string;
  conversacion_id: string;
  tipo: 'user' | 'bot';
  contenido: string;
  metadata?: Record<string, any>;
  created_at: string;
  
  // Relación
  conversacion?: Conversacion;
}

export interface Venta {
  id: string;
  cliente_id: string;
  conversacion_id?: string | null;
  producto_shopify_id: string;
  producto_nombre: string;
  producto_precio: number;
  cantidad: number;
  total: number;
  link_pago?: string | null;
  estado: 'pendiente' | 'pagado' | 'cancelado' | 'reembolsado';
  referencia_pago?: string | null;
  metodo_pago?: string | null;
  direccion_envio?: string | null;
  created_at: string;
  updated_at: string;

  // Relaciones
  cliente?: Cliente;
  conversacion?: Conversacion;
}

export interface Producto {
  id: string;
  shopify_id: string;
  titulo: string;
  descripcion?: string | null;
  precio: number;
  inventario: number;
  imagen_url?: string | null;
  categoria?: string | null;
  activo: boolean;
  metadata?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

// ──────────────────────────────────────────
// WHATSAPP
// ──────────────────────────────────────────

export interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  text?: {
    body: string;
  };
  type: 'text' | 'image' | 'document' | 'audio' | 'video';
}

export interface WhatsAppWebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: string;
        metadata: {
          display_phone_number: string;
          phone_number_id: string;
        };
        contacts?: Array<{
          profile: {
            name: string;
          };
          wa_id: string;
        }>;
        messages?: WhatsAppMessage[];
      };
      field: string;
    }>;
  }>;
}

export interface WhatsAppSendMessagePayload {
  messaging_product: 'whatsapp';
  to: string;
  type: 'text' | 'template' | 'interactive';
  text?: {
    body: string;
  };
  template?: {
    name: string;
    language: {
      code: string;
    };
  };
}

// ──────────────────────────────────────────
// SHOPIFY
// ──────────────────────────────────────────

export interface ShopifyProduct {
  id: number;
  title: string;
  body_html: string;
  vendor: string;
  product_type: string;
  created_at: string;
  handle: string;
  updated_at: string;
  published_at: string;
  template_suffix: string | null;
  status: string;
  published_scope: string;
  tags: string;
  admin_graphql_api_id: string;
  variants: ShopifyVariant[];
  options: ShopifyOption[];
  images: ShopifyImage[];
  image: ShopifyImage;
}

export interface ShopifyVariant {
  id: number;
  product_id: number;
  title: string;
  price: string;
  sku: string;
  position: number;
  inventory_policy: string;
  compare_at_price: string | null;
  fulfillment_service: string;
  inventory_management: string;
  option1: string;
  option2: string | null;
  option3: string | null;
  created_at: string;
  updated_at: string;
  taxable: boolean;
  barcode: string | null;
  grams: number;
  image_id: number | null;
  weight: number;
  weight_unit: string;
  inventory_item_id: number;
  inventory_quantity: number;
  old_inventory_quantity: number;
  requires_shipping: boolean;
  admin_graphql_api_id: string;
}

export interface ShopifyOption {
  id: number;
  product_id: number;
  name: string;
  position: number;
  values: string[];
}

export interface ShopifyImage {
  id: number;
  product_id: number;
  position: number;
  created_at: string;
  updated_at: string;
  alt: string | null;
  width: number;
  height: number;
  src: string;
  variant_ids: number[];
  admin_graphql_api_id: string;
}

// ──────────────────────────────────────────
// WOMPI (Pagos)
// ──────────────────────────────────────────

export interface WompiPaymentLink {
  id: string;
  name: string;
  description: string;
  single_use: boolean;
  collect_shipping: boolean;
  amount_in_cents: number;
  currency: string;
  redirect_url: string;
  permalink: string;
  created_at: string;
}

export interface WompiTransaction {
  id: string;
  amount_in_cents: number;
  reference: string;
  currency: string;
  payment_method_type: string;
  payment_method: {
    type: string;
    extra: Record<string, any>;
  };
  status: 'PENDING' | 'APPROVED' | 'DECLINED' | 'VOIDED' | 'ERROR';
  status_message: string | null;
  shipping_address: any | null;
  redirect_url: string;
  payment_link_id: string | null;
  customer_email: string;
  finalized_at: string | null;
  created_at: string;
}

export interface WompiWebhookEvent {
  event: 'transaction.updated';
  data: {
    transaction: WompiTransaction;
  };
  sent_at: string;
  signature: {
    checksum: string;
    properties: string[];
  };
}

// ──────────────────────────────────────────
// BOT & IA
// ──────────────────────────────────────────

export interface BotContext {
  cliente: Cliente;
  conversacion: Conversacion;
  mensajes_previos: Mensaje[];
}

export interface BotResponse {
  texto: string;
  accion?: 'generar_link_pago' | 'transferir_humano' | 'cerrar_conversacion' | 'transferir_a_asesor';
  producto_id?: string;
  metadata?: Record<string, any>;
}

export interface IntencionDetectada {
  tipo: 'saludo' | 'consulta_producto' | 'consulta_precio' | 'consulta_envio' | 'compra' | 'queja' | 'otro';
  confianza: number;
  entidades?: {
    producto?: string;
    ciudad?: string;
    cantidad?: number;
  };
}

// ──────────────────────────────────────────
// MÉTRICAS Y REPORTES
// ──────────────────────────────────────────

export interface MetricasDashboard {
  ventasHoy: number;
  ventasSemana: number;
  ventasMes: number;
  ingresosHoy: number;
  ingresosSemana: number;
  ingresosMes: number;
  clientesNuevos: number;
  conversacionesActivas: number;
  tasaConversion: number;
  ticketPromedio: number;
}

export interface VentaPorProducto {
  producto_nombre: string;
  cantidad_vendida: number;
  ingresos_totales: number;
  ultima_venta: string;
}

export interface VentaPorDia {
  fecha: string;
  cantidad: number;
  ingresos: number;
}

// ──────────────────────────────────────────
// SHOPIFY ORDERS & CARRITOS
// ──────────────────────────────────────────

export interface ShopifyOrder {
  id: number;
  order_number: number;
  email: string;
  phone?: string | null;
  customer?: {
    id: number;
    first_name: string;
    last_name: string;
    email: string;
    phone?: string | null;
  };
  billing_address?: { phone?: string | null };
  shipping_address?: { phone?: string | null; city?: string };
  line_items: Array<{
    id: number;
    title: string;
    quantity: number;
    price: string;
    variant_title?: string | null;
    product_id?: number;
  }>;
  total_price: string;
  subtotal_price: string;
  total_discounts: string;
  currency: string;
  financial_status: string;
  fulfillment_status: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShopifyCheckout {
  id: number;
  token: string;
  email?: string | null;
  phone?: string | null;
  customer?: {
    first_name?: string;
    last_name?: string;
    phone?: string | null;
  };
  billing_address?: { phone?: string | null };
  shipping_address?: { phone?: string | null };
  line_items: Array<{
    title: string;
    quantity: number;
    price: string;
  }>;
  total_price: string;
  abandoned_checkout_url: string;
  created_at: string;
  updated_at: string;
}

export interface PedidoShopify {
  id: string;
  shopify_order_id: number;
  shopify_order_number: string;
  cliente_id?: string | null;
  email?: string | null;
  telefono?: string | null;
  nombre_cliente?: string | null;
  total: number;
  subtotal: number;
  total_descuentos: number;
  moneda: string;
  estado_financiero: string;
  estado_fulfillment?: string | null;
  items: Array<{ title: string; quantity: number; price: number }>;
  direccion_envio?: Record<string, any> | null;
  shopify_created_at?: string | null;
  notificado_whatsapp: boolean;
  created_at: string;
  updated_at: string;
}

export interface CarritoAbandonado {
  id: string;
  shopify_checkout_id: string;
  shopify_token?: string | null;
  email?: string | null;
  telefono?: string | null;
  nombre?: string | null;
  total: number;
  items: Array<{ title: string; quantity: number; price: number }>;
  url_checkout?: string | null;
  estado: 'en_progreso' | 'abandonado' | 'notificado' | 'convertido';
  notificado_whatsapp: boolean;
  shopify_created_at?: string | null;
  shopify_updated_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface NotificacionWA {
  id: string;
  telefono: string;
  tipo: 'pedido_confirmado' | 'pedido_cancelado' | 'carrito_abandonado' | 'pedido_enviado';
  referencia_id?: string | null;
  mensaje?: string | null;
  estado: 'enviado' | 'fallido';
  error?: string | null;
  whatsapp_message_id?: string | null;
  created_at: string;
}

// ──────────────────────────────────────────
// CONFIGURACIÓN
// ──────────────────────────────────────────

export interface ConfiguracionNegocio {
  nombre: string;
  telefono: string;
  email: string;
  cobertura_envios: string[];
  costo_envio: number;
  envio_gratis_desde: number;
}

export interface RespuestaAutomatica {
  id: string;
  trigger: string; // keyword que dispara la respuesta
  respuesta: string;
  activa: boolean;
  prioridad: number;
  created_at: string;
  updated_at: string;
}

// ──────────────────────────────────────────
// API RESPONSES
// ──────────────────────────────────────────

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code?: string;
    details?: any;
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
}
