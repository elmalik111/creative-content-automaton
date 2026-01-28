-- =====================================================
-- SECURITY FIX: Implement Authentication & Role-Based Access Control
-- =====================================================

-- 1. Create Role Enum
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- 2. Create User Roles Table
CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE (user_id, role)
);

-- Enable RLS on user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 3. Create Security Definer Function to Check Roles (prevents RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- 4. Create helper function to check if user is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin')
$$;

-- 5. User roles policies - only admins can manage roles
CREATE POLICY "Admins can manage user_roles"
  ON public.user_roles
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Users can read their own roles"
  ON public.user_roles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- =====================================================
-- FIX: api_keys - Restrict to authenticated admins only
-- =====================================================
DROP POLICY IF EXISTS "Allow public read for api_keys" ON public.api_keys;
DROP POLICY IF EXISTS "Allow public insert for api_keys" ON public.api_keys;
DROP POLICY IF EXISTS "Allow public update for api_keys" ON public.api_keys;
DROP POLICY IF EXISTS "Allow public delete for api_keys" ON public.api_keys;

CREATE POLICY "Admins can manage api_keys"
  ON public.api_keys
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- =====================================================
-- FIX: elevenlabs_keys - Restrict to authenticated admins only
-- =====================================================
DROP POLICY IF EXISTS "Allow all access to elevenlabs_keys" ON public.elevenlabs_keys;

CREATE POLICY "Admins can manage elevenlabs_keys"
  ON public.elevenlabs_keys
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- =====================================================
-- FIX: oauth_tokens - Restrict to authenticated admins only
-- =====================================================
DROP POLICY IF EXISTS "Allow public read for oauth_tokens" ON public.oauth_tokens;
DROP POLICY IF EXISTS "Allow public insert for oauth_tokens" ON public.oauth_tokens;
DROP POLICY IF EXISTS "Allow public update for oauth_tokens" ON public.oauth_tokens;
DROP POLICY IF EXISTS "Allow public delete for oauth_tokens" ON public.oauth_tokens;

CREATE POLICY "Admins can manage oauth_tokens"
  ON public.oauth_tokens
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- =====================================================
-- FIX: settings - Restrict to authenticated admins only
-- =====================================================
DROP POLICY IF EXISTS "Allow all access to settings" ON public.settings;

CREATE POLICY "Admins can manage settings"
  ON public.settings
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- =====================================================
-- FIX: jobs - Authenticated users can view/manage jobs
-- =====================================================
DROP POLICY IF EXISTS "Allow all access to jobs" ON public.jobs;

-- Authenticated users can read jobs
CREATE POLICY "Authenticated users can read jobs"
  ON public.jobs
  FOR SELECT
  TO authenticated
  USING (true);

-- Admins can manage all jobs
CREATE POLICY "Admins can manage jobs"
  ON public.jobs
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Service role can manage jobs (for edge functions)
-- Note: Service role bypasses RLS, so this policy is for documentation

-- =====================================================
-- FIX: job_steps - Follow jobs access pattern
-- =====================================================
DROP POLICY IF EXISTS "Allow public read for job_steps" ON public.job_steps;
DROP POLICY IF EXISTS "Allow public insert for job_steps" ON public.job_steps;
DROP POLICY IF EXISTS "Allow public update for job_steps" ON public.job_steps;
DROP POLICY IF EXISTS "Allow public delete for job_steps" ON public.job_steps;

CREATE POLICY "Authenticated users can read job_steps"
  ON public.job_steps
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage job_steps"
  ON public.job_steps
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- =====================================================
-- FIX: Storage - Restrict uploads to authenticated users
-- =====================================================
DROP POLICY IF EXISTS "Allow uploads to media-input" ON storage.objects;
DROP POLICY IF EXISTS "Allow updates to media-input" ON storage.objects;
DROP POLICY IF EXISTS "Allow deletes from media-input" ON storage.objects;

-- Only authenticated users can upload to media-input
CREATE POLICY "Authenticated users can upload to media-input"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'media-input');

-- Only authenticated users can update in media-input
CREATE POLICY "Authenticated users can update media-input"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'media-input');

-- Only authenticated users can delete from media-input
CREATE POLICY "Authenticated users can delete from media-input"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'media-input');