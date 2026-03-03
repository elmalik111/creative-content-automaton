
-- Fix search_path on functions missing it

CREATE OR REPLACE FUNCTION public.update_job_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
BEGIN
  UPDATE public.jobs SET updated_at = NOW() WHERE id = NEW.job_id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.auto_set_settings_user_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
  IF NEW.user_id IS NULL AND auth.uid() IS NOT NULL THEN
    NEW.user_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.auto_set_user_id_on_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
  IF NEW.user_id IS NULL THEN
    NEW.user_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_settings_user_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
  IF NEW.user_id IS NULL AND auth.uid() IS NOT NULL THEN
    NEW.user_id = auth.uid();
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_user_setting(p_key text, p_value text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  INSERT INTO settings (key, value, user_id, updated_at)
  VALUES (p_key, p_value, v_user_id, NOW())
  ON CONFLICT (COALESCE(user_id::text, 'global'), key)
  DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_user_setting(p_key text, p_value text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  INSERT INTO settings (key, value, user_id, updated_at)
  VALUES (p_key, p_value, v_user_id, NOW())
  ON CONFLICT (user_id, key)
  DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
END;
$function$;

-- Fix telegram_chat_users overly permissive RLS policy
DROP POLICY IF EXISTS "service_role_all" ON public.telegram_chat_users;

CREATE POLICY "Admins can manage telegram_chat_users"
  ON public.telegram_chat_users
  FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());
