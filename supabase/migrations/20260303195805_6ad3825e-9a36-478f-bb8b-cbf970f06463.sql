
DROP VIEW IF EXISTS public.user_settings;
CREATE VIEW public.user_settings WITH (security_invoker = true) AS
SELECT DISTINCT ON (key) id,
    key,
    value,
    user_id,
    updated_at
FROM settings
WHERE ((user_id = auth.uid()) OR (user_id IS NULL))
ORDER BY key, (user_id = auth.uid()) DESC, updated_at DESC;
