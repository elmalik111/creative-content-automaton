-- Fix SECURITY DEFINER view issue by using SECURITY INVOKER
DROP VIEW IF EXISTS public.oauth_tokens_safe;

CREATE VIEW public.oauth_tokens_safe
WITH (security_invoker = true)
AS
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

-- Re-grant access
GRANT SELECT ON public.oauth_tokens_safe TO authenticated;

-- Add a SELECT policy for admins to read from oauth_tokens table (needed for the view)
CREATE POLICY "Admins can read oauth_tokens"
  ON public.oauth_tokens AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (public.is_admin());