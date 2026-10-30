-- ============================================================
-- Octubre 2026 — Fase 3: auditoría, embudo empresarial, difusiones
--                        y estado de la conversación
-- ============================================================
-- Sin esta migración el CRM y el bot siguen funcionando como antes; las
-- secciones nuevas avisan que falta correrla.

-- ─── Registro de actividad: quién hizo qué en el CRM ────────────────
CREATE TABLE IF NOT EXISTS auditoria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor TEXT,                 -- correo de quien hizo la acción ('sistema' si fue automático)
  actor_nombre TEXT,
  accion TEXT NOT NULL,       -- ej. 'conversacion.tomar', 'equipo.crear'
  entidad TEXT,               -- ej. 'conversacion', 'oportunidad'
  entidad_id TEXT,
  detalle JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS auditoria_fecha_idx ON auditoria (created_at DESC);
CREATE INDEX IF NOT EXISTS auditoria_actor_idx ON auditoria (actor);

-- ─── Embudo de ventas empresariales ─────────────────────────────────
CREATE TABLE IF NOT EXISTS oportunidades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversacion_id UUID REFERENCES conversaciones(id) ON DELETE SET NULL,
  cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
  empresa TEXT,
  contacto TEXT,
  correo TEXT,
  telefono TEXT,
  etapa TEXT NOT NULL DEFAULT 'nueva'
    CHECK (etapa IN ('nueva', 'contactada', 'cotizada', 'ganada', 'perdida')),
  valor_estimado NUMERIC,
  unidades INT,
  necesidad TEXT,             -- lo que pidió el cliente
  notas TEXT,
  motivo_perdida TEXT,
  asignado_a TEXT,
  asignado_nombre TEXT,
  cerrada_en TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS oportunidades_etapa_idx ON oportunidades (etapa);
CREATE UNIQUE INDEX IF NOT EXISTS oportunidades_conversacion_abierta
  ON oportunidades (conversacion_id) WHERE etapa NOT IN ('ganada', 'perdida') AND conversacion_id IS NOT NULL;

-- Las solicitudes empresariales que ya dejaron su correo entran al embudo
INSERT INTO oportunidades (conversacion_id, cliente_id, contacto, telefono, necesidad, correo, created_at)
SELECT DISTINCT ON (l.conversacion_id)
       l.conversacion_id, l.cliente_id, l.nombre_cliente, l.telefono_cliente, l.mensaje_original,
       substring(l.mensaje_original from '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'), l.created_at
FROM leads_sedes l
WHERE l.sede = 'Ventas Empresariales'
  AND l.conversacion_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM oportunidades o WHERE o.conversacion_id = l.conversacion_id)
ORDER BY l.conversacion_id, l.created_at DESC;

-- ─── Difusiones (mensajes masivos con plantilla aprobada) ───────────
CREATE TABLE IF NOT EXISTS difusiones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  plantilla TEXT NOT NULL,
  idioma TEXT NOT NULL DEFAULT 'es',
  categoria TEXT,
  parametros JSONB,           -- valores de {{1}}, {{2}}…; admite {nombre}
  segmento JSONB,             -- filtros usados para elegir a quién
  total INT NOT NULL DEFAULT 0,
  enviados INT NOT NULL DEFAULT 0,
  fallidos INT NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'borrador'
    CHECK (estado IN ('borrador', 'enviando', 'completada', 'cancelada')),
  creado_por TEXT,
  creado_nombre TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completada_en TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS difusion_envios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  difusion_id UUID NOT NULL REFERENCES difusiones(id) ON DELETE CASCADE,
  cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
  telefono TEXT NOT NULL,
  nombre TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'enviado', 'fallido')),
  error TEXT,
  whatsapp_message_id TEXT,
  enviado_en TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS difusion_envios_pendientes ON difusion_envios (difusion_id, estado);

-- Quien pide no recibir más publicidad queda fuera de toda difusión
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS no_publicidad BOOLEAN NOT NULL DEFAULT FALSE;

-- ─── Estado de la conversación con el bot ──────────────────────────
-- Antes el paso en que iba el cliente (y su carrito) se leía del último
-- mensaje del bot: un mensaje de un asesor o un recordatorio automático
-- lo borraba. Ahora vive aquí.
CREATE TABLE IF NOT EXISTS estado_conversacion (
  conversacion_id UUID PRIMARY KEY REFERENCES conversaciones(id) ON DELETE CASCADE,
  estado JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Solo el servidor (service key) lee y escribe estas tablas
ALTER TABLE auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE oportunidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE difusiones ENABLE ROW LEVEL SECURITY;
ALTER TABLE difusion_envios ENABLE ROW LEVEL SECURITY;
ALTER TABLE estado_conversacion ENABLE ROW LEVEL SECURITY;
