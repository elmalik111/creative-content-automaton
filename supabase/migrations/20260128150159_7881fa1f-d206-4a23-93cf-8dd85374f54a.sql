-- =====================================================
-- FIX: Create PERMISSIVE policies (default type)
-- The issue is policies are RESTRICTIVE but need PERMISSIVE
-- =====================================================

-- api_keys
DROP POLICY IF EXISTS "Admins can manage api_keys" ON public.api_keys;
CREATE POLICY "Admins can manage api_keys"
  ON public.api_keys AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- elevenlabs_keys
DROP POLICY IF EXISTS "Admins can manage elevenlabs_keys" ON public.elevenlabs_keys;
CREATE POLICY "Admins can manage elevenlabs_keys"
  ON public.elevenlabs_keys AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- oauth_tokens
DROP POLICY IF EXISTS "Admins can manage oauth_tokens" ON public.oauth_tokens;
CREATE POLICY "Admins can manage oauth_tokens"
  ON public.oauth_tokens AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- settings
DROP POLICY IF EXISTS "Admins can manage settings" ON public.settings;
CREATE POLICY "Admins can manage settings"
  ON public.settings AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- jobs
DROP POLICY IF EXISTS "Admins can manage jobs" ON public.jobs;
DROP POLICY IF EXISTS "Authenticated users can read jobs" ON public.jobs;
CREATE POLICY "Admins can manage jobs"
  ON public.jobs AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- job_steps
DROP POLICY IF EXISTS "Admins can manage job_steps" ON public.job_steps;
CREATE POLICY "Admins can manage job_steps"
  ON public.job_steps AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- user_roles
DROP POLICY IF EXISTS "Admins can manage user_roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can read their own roles" ON public.user_roles;

CREATE POLICY "Admins can manage user_roles"
  ON public.user_roles AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Users can read their own roles"
  ON public.user_roles AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);