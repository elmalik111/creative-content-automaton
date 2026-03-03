
-- Recreate views with security_invoker = true

DROP VIEW IF EXISTS public.elevenlabs_keys_stats;
CREATE VIEW public.elevenlabs_keys_stats WITH (security_invoker = true) AS
SELECT k.id,
    k.name,
    k.is_active,
    k.usage_count,
    k.last_used_at,
    k.character_count,
    k.character_limit,
    CASE
        WHEN (k.character_limit > 0) THEN round((((k.character_count)::numeric / (k.character_limit)::numeric) * (100)::numeric), 2)
        ELSE (0)::numeric
    END AS usage_percentage,
    count(l.id) AS total_requests,
    count(CASE WHEN l.success THEN 1 ELSE NULL::integer END) AS successful_requests,
    count(CASE WHEN (NOT l.success) THEN 1 ELSE NULL::integer END) AS failed_requests,
    CASE
        WHEN (count(l.id) > 0) THEN round((((count(CASE WHEN l.success THEN 1 ELSE NULL::integer END))::numeric / (count(l.id))::numeric) * (100)::numeric), 2)
        ELSE (0)::numeric
    END AS success_rate,
    max(l."timestamp") AS last_request_at
FROM elevenlabs_keys k
LEFT JOIN elevenlabs_key_logs l ON (k.id = l.key_id)
GROUP BY k.id, k.name, k.is_active, k.usage_count, k.last_used_at, k.character_count, k.character_limit;

DROP VIEW IF EXISTS public.elevenlabs_recent_errors;
CREATE VIEW public.elevenlabs_recent_errors WITH (security_invoker = true) AS
SELECT l.id,
    l."timestamp",
    k.name AS key_name,
    l.error_message,
    l.text_length
FROM elevenlabs_key_logs l
JOIN elevenlabs_keys k ON (l.key_id = k.id)
WHERE l.success = false
ORDER BY l."timestamp" DESC
LIMIT 100;
