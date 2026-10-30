-- ============================================================
-- Octubre 2026 — Fase 2: configuración de la atención y encuestas
-- ============================================================
-- configuracion: horario del equipo y encuesta (las edita un administrador
--                en CRM → Configuración).
-- encuestas:     calificación que da el cliente al resolverse su caso.
-- Sin esta migración el CRM y el bot funcionan, pero no hay horario ni
-- se guardan las encuestas.

CREATE TABLE IF NOT EXISTS configuracion (
  clave TEXT PRIMARY KEY,
  valor JSONB,
  actualizado_por TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS encuestas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversacion_id UUID REFERENCES conversaciones(id) ON DELETE CASCADE,
  cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
  asesor TEXT,
  asesor_nombre TEXT,
  calificacion SMALLINT NOT NULL CHECK (calificacion BETWEEN 1 AND 3), -- 3 excelente, 2 buena, 1 mala
  comentario TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS encuestas_fecha_idx ON encuestas (created_at DESC);
CREATE INDEX IF NOT EXISTS encuestas_asesor_idx ON encuestas (asesor);

-- Solo el servidor (service key) lee y escribe estas tablas
ALTER TABLE configuracion ENABLE ROW LEVEL SECURITY;
ALTER TABLE encuestas ENABLE ROW LEVEL SECURITY;
