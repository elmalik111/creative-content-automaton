-- =====================================================
-- FIX: Convert RESTRICTIVE policies to PERMISSIVE
-- RESTRICTIVE policies only add restrictions, they don't enable access
-- We need PERMISSIVE policies that grant access to admins
-- =====================================================

-- FIX: api_keys - Drop and recreate as PERMISSIVE
DROP POLICY IF EXISTS "Admins can manage api_keys" ON public.api_keys;

CREATE POLICY "Admins can manage api_keys"
  ON public.api_keys
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- FIX: elevenlabs_keys - Drop and recreate as PERMISSIVE  
DROP POLICY IF EXISTS "Admins can manage elevenlabs_keys" ON public.elevenlabs_keys;

CREATE POLICY "Admins can manage elevenlabs_keys"
  ON public.elevenlabs_keys
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- FIX: oauth_tokens - Drop and recreate as PERMISSIVE
DROP POLICY IF EXISTS "Admins can manage oauth_tokens" ON public.oauth_tokens;

CREATE POLICY "Admins can manage oauth_tokens"
  ON public.oauth_tokens
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- FIX: settings - Drop and recreate as PERMISSIVE
DROP POLICY IF EXISTS "Admins can manage settings" ON public.settings;

CREATE POLICY "Admins can manage settings"
  ON public.settings
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- FIX: jobs - Drop and recreate as PERMISSIVE
DROP POLICY IF EXISTS "Authenticated users can read jobs" ON public.jobs;
DROP POLICY IF EXISTS "Admins can manage jobs" ON public.jobs;

-- Admins can do everything with jobs
CREATE POLICY "Admins can manage jobs"
  ON public.jobs
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Authenticated users can only read jobs (for dashboard viewing)
CREATE POLICY "Authenticated users can read jobs"
  ON public.jobs
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- FIX: job_steps - Drop and recreate as PERMISSIVE
DROP POLICY IF EXISTS "Authenticated users can read job_steps" ON public.job_steps;
DROP POLICY IF EXISTS "Admins can manage job_steps" ON public.job_steps;

-- Admins can do everything
CREATE POLICY "Admins can manage job_steps"
  ON public.job_steps
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- FIX: user_roles - Drop and recreate properly
DROP POLICY IF EXISTS "Admins can manage user_roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can read their own roles" ON public.user_roles;

-- Admins can manage all roles
CREATE POLICY "Admins can manage user_roles"
  ON public.user_roles
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Users can only read their own roles
CREATE POLICY "Users can read their own roles"
  ON public.user_roles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);