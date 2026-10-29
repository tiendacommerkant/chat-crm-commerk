-- ============================================================
-- Octubre 2026 — atención profesional en el CRM
-- ============================================================
-- Bandeja de atención humana, asignación por asesor, notas internas,
-- respuestas rápidas editables y registro de eventos del sistema.
--
-- El código funciona aunque esta migración no se haya corrido (se comporta
-- como antes), pero la bandeja "Pendientes", la asignación, las notas y las
-- respuestas rápidas editables solo se activan después de correrla.

-- ─── Estado de atención de cada conversación ───────────────────────
--   bot          → la atiende Sofi
--   pendiente    → el bot la pasó a un asesor y nadie la ha tomado
--   en_atencion  → un asesor la tomó (el bot no responde)
ALTER TABLE conversaciones
  ADD COLUMN IF NOT EXISTS estado_atencion TEXT NOT NULL DEFAULT 'bot',
  ADD COLUMN IF NOT EXISTS asignado_a TEXT,
  ADD COLUMN IF NOT EXISTS asignado_nombre TEXT,
  ADD COLUMN IF NOT EXISTS pendiente_desde TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS atendido_desde TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS motivo_transferencia TEXT;

ALTER TABLE conversaciones DROP CONSTRAINT IF EXISTS conversaciones_estado_atencion_check;
ALTER TABLE conversaciones ADD CONSTRAINT conversaciones_estado_atencion_check
  CHECK (estado_atencion IN ('bot', 'pendiente', 'en_atencion'));

CREATE INDEX IF NOT EXISTS conversaciones_estado_atencion_idx ON conversaciones (estado_atencion);
CREATE INDEX IF NOT EXISTS conversaciones_asignado_a_idx ON conversaciones (asignado_a);

-- Las conversaciones que hoy tienen el bot apagado quedan pendientes de asesor
UPDATE conversaciones
   SET estado_atencion = 'pendiente', pendiente_desde = COALESCE(pendiente_desde, updated_at)
 WHERE bot_activo = false AND estado_atencion = 'bot';

-- ─── Notas internas (solo las ve el equipo, nunca el cliente ni el bot) ──
CREATE TABLE IF NOT EXISTS notas_conversacion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversacion_id UUID NOT NULL REFERENCES conversaciones(id) ON DELETE CASCADE,
  autor TEXT NOT NULL,
  autor_nombre TEXT,
  contenido TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notas_conversacion_conv_idx ON notas_conversacion (conversacion_id, created_at);

-- ─── Respuestas rápidas editables desde el CRM ─────────────────────
CREATE TABLE IF NOT EXISTS respuestas_rapidas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  atajo TEXT NOT NULL,
  contenido TEXT NOT NULL,
  orden INT NOT NULL DEFAULT 0,
  creado_por TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO respuestas_rapidas (atajo, contenido, orden)
SELECT * FROM (VALUES
  ('saludo',  '¡Hola! 👋 Soy del equipo de Tienda Commerk. ¿En qué te puedo ayudar?', 1),
  ('espera',  '⏳ Dame un momento, estoy verificando tu información.', 2),
  ('pago',    '✅ Recibimos tu pago correctamente. ¡Gracias por tu compra!', 3),
  ('camino',  '🚚 Tu pedido ya está en camino. Te avisamos cuando llegue.', 4),
  ('cierre',  '¡Gracias por escribirnos! 🙏 Si necesitas algo más, aquí estamos.', 5)
) AS v(atajo, contenido, orden)
WHERE NOT EXISTS (SELECT 1 FROM respuestas_rapidas);

-- ─── Eventos del sistema (errores y avisos para el panel de estado) ──
CREATE TABLE IF NOT EXISTS eventos_sistema (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nivel TEXT NOT NULL CHECK (nivel IN ('info', 'aviso', 'error')),
  origen TEXT NOT NULL,
  mensaje TEXT NOT NULL,
  detalle JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS eventos_sistema_fecha_idx ON eventos_sistema (created_at DESC);

-- Solo el servidor (service key) lee y escribe estas tablas
ALTER TABLE notas_conversacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE respuestas_rapidas ENABLE ROW LEVEL SECURITY;
ALTER TABLE eventos_sistema ENABLE ROW LEVEL SECURITY;
