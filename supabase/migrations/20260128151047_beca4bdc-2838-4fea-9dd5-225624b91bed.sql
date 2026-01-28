-- =====================================================
-- SECURITY FIX: Storage bucket policies
-- Remove public write access from media-output and temp-files
-- =====================================================

-- Drop public write policies on media-output bucket
DROP POLICY IF EXISTS "Allow uploads to media-output" ON storage.objects;
DROP POLICY IF EXISTS "Allow updates to media-output" ON storage.objects;
DROP POLICY IF EXISTS "Allow deletes from media-output" ON storage.objects;

-- Drop all public access policies on temp-files bucket (service role bypasses RLS)
DROP POLICY IF EXISTS "Allow all access to temp-files" ON storage.objects;

-- =====================================================
-- SECURITY FIX: OAuth tokens - create safe view
-- Expose only non-sensitive fields to prevent token leakage
-- =====================================================

-- Create a view that exposes only safe fields (no tokens)
CREATE OR REPLACE VIEW public.oauth_tokens_safe AS
SELECT 
  id,
  platform,
  account_name,
  is_active,
  expires_at,
  scope,
  created_at,
  updated_at
FROM public.oauth_tokens;

-- Grant access to the safe view
GRANT SELECT ON public.oauth_tokens_safe TO authenticated;

-- Update RLS policy on oauth_tokens to deny SELECT for non-service-role
-- First, drop the existing policy
DROP POLICY IF EXISTS "Admins can manage oauth_tokens" ON public.oauth_tokens;

-- Create separate policies: admin can INSERT/UPDATE/DELETE but NOT SELECT directly
CREATE POLICY "Admins can insert oauth_tokens"
  ON public.oauth_tokens AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update oauth_tokens"
  ON public.oauth_tokens AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete oauth_tokens"
  ON public.oauth_tokens AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (public.is_admin());