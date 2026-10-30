-- ============================================================
-- RECUPERACIÓN DE CARRITOS 24/7 (cada 10 minutos)
-- ============================================================
-- Hasta ahora los carritos de Shopify solo se revisaban con el CRM abierto
-- o una vez al día. Esta tarea de Supabase llama al CRM cada 10 minutos.
-- El CRM solo escribe de 8 a. m. a 8 p. m. (hora de Colombia): lo que se
-- abandone de noche se recuerda a la mañana siguiente.
--
-- ANTES DE CORRER: reemplaza PEGA_AQUI_EL_CRON_SECRET (abajo, una sola vez)
-- por el valor de CRON_SECRET de Vercel (Settings → Environment Variables).
-- Queda cifrado en el Vault de Supabase; no lo guardes en ningún archivo.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- 1) Clave de las tareas programadas, cifrada en el Vault
do $$
declare
  v_secreto text := 'PEGA_AQUI_EL_CRON_SECRET';
  v_id uuid;
begin
  if v_secreto = 'PEGA_AQUI_EL_CRON_SECRET' or length(v_secreto) < 16 then
    raise exception 'Falta pegar el valor de CRON_SECRET de Vercel en v_secreto';
  end if;
  select id into v_id from vault.secrets where name = 'crm_cron_secret';
  if v_id is null then
    perform vault.create_secret(v_secreto, 'crm_cron_secret', 'Clave de las tareas programadas del CRM Commerk');
  else
    perform vault.update_secret(v_id, v_secreto);
  end if;
end $$;

-- 2) Tarea cada 10 minutos (si ya existía, se reemplaza)
select cron.unschedule(jobid) from cron.job where jobname = 'crm-recuperar-carritos';

select cron.schedule(
  'crm-recuperar-carritos',
  '*/10 * * * *',
  $tarea$
  select net.http_post(
    url := 'https://crmbot.tiendacommerkant.com.co/api/cron/recuperar-carritos',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'crm_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $tarea$
);

-- ============================================================
-- VERIFICAR (después de 10-15 minutos):
--   select status_code, left(content::text, 200) as respuesta, created
--   from net._http_response order by created desc limit 5;
-- status_code 200 = funciona. 401 = la clave no coincide con CRON_SECRET.
--
-- APAGAR LA TAREA:
--   select cron.unschedule('crm-recuperar-carritos');
-- ============================================================
