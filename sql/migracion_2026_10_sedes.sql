-- ============================================================
-- CUENTAS DE SEDE Y SEGUIMIENTO DE LEADS MAYORISTAS
-- ============================================================
-- 1) leads_sedes guarda cómo va cada lead: nuevo → contactado → vendido /
--    no se concretó, una nota y quién lo actualizó.
-- 2) Las cuentas con rol "sede" solo ven sus leads a través del CRM (la API
--    filtra por la sede de su sesión). Aquí se asegura que tampoco puedan
--    leer ninguna tabla directamente con su sesión de Supabase.
-- Se puede correr más de una vez.
-- ============================================================

ALTER TABLE leads_sedes ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'nuevo';
ALTER TABLE leads_sedes ADD COLUMN IF NOT EXISTS nota TEXT;
ALTER TABLE leads_sedes ADD COLUMN IF NOT EXISTS atendido_por TEXT;
ALTER TABLE leads_sedes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS leads_sedes_sede_idx ON leads_sedes (sede, created_at DESC);

-- La política de lectura del CRM ahora excluye a las cuentas de sede
DO $$
DECLARE
  tablas TEXT[];
  t TEXT;
BEGIN
  SELECT array_agg(tablename) INTO tablas
  FROM pg_policies WHERE schemaname = 'public' AND policyname = 'crm_lectura';

  FOREACH t IN ARRAY coalesce(tablas, ARRAY[]::TEXT[]) LOOP
    EXECUTE format('DROP POLICY crm_lectura ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY crm_lectura ON public.%I FOR SELECT TO authenticated USING ('
      'coalesce((auth.jwt() -> ''app_metadata'' ->> ''crm_acceso'')::boolean, false) '
      'AND coalesce(auth.jwt() -> ''app_metadata'' ->> ''rol'', '''') <> ''sede'')',
      t
    );
  END LOOP;
END $$;

-- ============================================================
-- VERIFICAR: todas las filas deben mostrar "<> 'sede'" en la condición
--   SELECT tablename, qual FROM pg_policies
--   WHERE schemaname = 'public' AND policyname = 'crm_lectura' ORDER BY 1;
-- ============================================================
