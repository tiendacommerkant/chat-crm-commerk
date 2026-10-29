-- ============================================================
-- Octubre 2026 — los datos de clientes solo los leen usuarios del CRM
-- ============================================================
-- Antes las políticas eran "FOR SELECT USING (true)" sin rol: la llave
-- pública (anon), que va dentro del JavaScript del CRM, podía leer clientes,
-- conversaciones, mensajes, ventas, pedidos y carritos sin iniciar sesión, y
-- escuchar los mensajes nuevos en tiempo real.
--
-- Ahora solo leen los usuarios autenticados con app_metadata.crm_acceso =
-- true. Ese dato solo lo puede asignar el servidor (service key), así que una
-- cuenta creada por fuera no obtiene acceso. El bot y las rutas /api usan la
-- service key, que no pasa por RLS: siguen funcionando igual.
--
-- Después de correrla, cada usuario debe cerrar sesión y volver a entrar
-- para que su token incluya crm_acceso.

DO $$
DECLARE
  t text;
  p record;
BEGIN
  -- Tablas que el dashboard lee directo desde el navegador (y Realtime)
  FOREACH t IN ARRAY ARRAY[
    'clientes', 'conversaciones', 'mensajes', 'ventas', 'productos',
    'pedidos_shopify', 'carritos_abandonados'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;
    EXECUTE format(
      'CREATE POLICY crm_lectura ON public.%I FOR SELECT TO authenticated '
      'USING (coalesce((auth.jwt() -> ''app_metadata'' ->> ''crm_acceso'')::boolean, false))',
      t
    );
  END LOOP;

  -- Tablas que solo usa el servidor: sin ninguna política nadie más las lee
  FOREACH t IN ARRAY ARRAY['notificaciones_wa', 'leads_sedes', 'uso_costos'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;
  END LOOP;
END $$;

-- Verificación: debe listar solo crm_lectura en las 7 primeras tablas
-- SELECT tablename, policyname, roles, cmd FROM pg_policies WHERE schemaname = 'public' ORDER BY 1;
