-- SCHEMA SUPABASE - Chatbot CRM Commerk
-- Ejecutar en: Supabase Dashboard → SQL Editor → New Query

CREATE TABLE IF NOT EXISTS clientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telefono VARCHAR(20) UNIQUE NOT NULL,
  nombre VARCHAR(100),
  email VARCHAR(100),
  ciudad VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID REFERENCES clientes(id) ON DELETE CASCADE,
  estado VARCHAR(20) DEFAULT 'activa',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mensajes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversacion_id UUID REFERENCES conversaciones(id) ON DELETE CASCADE,
  tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('user', 'bot')),
  contenido TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ventas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID REFERENCES clientes(id),
  conversacion_id UUID REFERENCES conversaciones(id),
  producto_shopify_id VARCHAR(50),
  producto_nombre VARCHAR(200),
  producto_precio DECIMAL(10, 2),
  cantidad INT DEFAULT 1,
  total DECIMAL(10, 2),
  link_pago TEXT,
  referencia_pago VARCHAR(100),
  estado VARCHAR(20) DEFAULT 'pendiente',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS productos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_id VARCHAR(50) UNIQUE,
  titulo VARCHAR(200),
  descripcion TEXT,
  precio DECIMAL(10, 2),
  inventario INT,
  imagen_url TEXT,
  categoria VARCHAR(100),
  activo BOOLEAN DEFAULT TRUE,
  tags JSONB,
  metadata JSONB,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ─── POLÍTICAS RLS (Row Level Security) ────────────────────────────
-- Permitir lectura pública para el dashboard (anon key del navegador)

ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE mensajes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ventas ENABLE ROW LEVEL SECURITY;
ALTER TABLE productos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dashboard_read_clientes"      ON clientes      FOR SELECT USING (true);
CREATE POLICY "dashboard_read_conversaciones" ON conversaciones FOR SELECT USING (true);
CREATE POLICY "dashboard_read_mensajes"      ON mensajes      FOR SELECT USING (true);
CREATE POLICY "dashboard_read_ventas"        ON ventas        FOR SELECT USING (true);
CREATE POLICY "dashboard_read_productos"     ON productos     FOR SELECT USING (true);

-- ─── PEDIDOS SINCRONIZADOS DESDE SHOPIFY ───────────────────────────
CREATE TABLE IF NOT EXISTS pedidos_shopify (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_order_id BIGINT UNIQUE NOT NULL,
  shopify_order_number VARCHAR(20),
  cliente_id UUID REFERENCES clientes(id),
  email VARCHAR(200),
  telefono VARCHAR(30),
  nombre_cliente VARCHAR(200),
  total DECIMAL(10,2),
  subtotal DECIMAL(10,2),
  total_descuentos DECIMAL(10,2) DEFAULT 0,
  moneda VARCHAR(10) DEFAULT 'COP',
  estado_financiero VARCHAR(50),
  estado_fulfillment VARCHAR(50),
  items JSONB,
  direccion_envio JSONB,
  shopify_created_at TIMESTAMP,
  notificado_whatsapp BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ─── CARRITOS ABANDONADOS (Shopify Checkouts) ──────────────────────
CREATE TABLE IF NOT EXISTS carritos_abandonados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_checkout_id VARCHAR(50) UNIQUE NOT NULL,
  shopify_token VARCHAR(100),
  email VARCHAR(200),
  telefono VARCHAR(30),
  nombre VARCHAR(200),
  total DECIMAL(10,2),
  items JSONB,
  url_checkout TEXT,
  estado VARCHAR(20) DEFAULT 'en_progreso',
  notificado_whatsapp BOOLEAN DEFAULT FALSE,
  shopify_created_at TIMESTAMP,
  shopify_updated_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ─── LOG DE NOTIFICACIONES WHATSAPP ENVIADAS ───────────────────────
CREATE TABLE IF NOT EXISTS notificaciones_wa (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telefono VARCHAR(30) NOT NULL,
  tipo VARCHAR(50) NOT NULL,
  referencia_id VARCHAR(100),
  mensaje TEXT,
  estado VARCHAR(20) DEFAULT 'enviado',
  error TEXT,
  whatsapp_message_id VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

-- ─── RLS PARA NUEVAS TABLAS ────────────────────────────────────────
ALTER TABLE pedidos_shopify ENABLE ROW LEVEL SECURITY;
ALTER TABLE carritos_abandonados ENABLE ROW LEVEL SECURITY;
ALTER TABLE notificaciones_wa ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dashboard_read_pedidos"    ON pedidos_shopify    FOR SELECT USING (true);
CREATE POLICY "dashboard_read_carritos"   ON carritos_abandonados FOR SELECT USING (true);
CREATE POLICY "dashboard_read_notifs"     ON notificaciones_wa  FOR SELECT USING (true);
