-- ============================================================
-- Octubre 2026 — clientes con nombre de usuario de WhatsApp
-- ============================================================
-- WhatsApp permite que el cliente use un nombre de usuario y oculte su
-- número. En ese caso Meta no envía el teléfono en el webhook sino un ID de
-- usuario (BSUID) de hasta 131 caracteres, ej. "CO.13491208655302741918".
-- Para esos clientes `telefono` guarda ese ID, y `wa_user_id` permite
-- reconocerlos aunque unas veces escriban con número y otras sin él.

ALTER TABLE clientes ALTER COLUMN telefono TYPE TEXT;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS wa_user_id TEXT;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS wa_username TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS clientes_wa_user_id_key
  ON clientes (wa_user_id) WHERE wa_user_id IS NOT NULL;

-- Ya aplicada el 2026-10-13 (bloqueo por conversación contra mensajes
-- simultáneos que corrompían el carrito):
--   ALTER TABLE conversaciones
--     ADD COLUMN lock_token UUID,
--     ADD COLUMN locked_at TIMESTAMPTZ;
