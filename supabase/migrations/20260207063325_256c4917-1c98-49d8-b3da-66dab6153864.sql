
-- تحديث جميع المهام العالقة في حالة processing بدون output_url إلى failed
UPDATE public.jobs 
SET 
  status = 'failed', 
  error_message = 'سيرفر الدمج (FFmpeg Space) كان معطلاً. يرجى إعادة المحاولة.',
  updated_at = now()
WHERE status = 'processing' AND output_url IS NULL;

-- إعادة تفعيل جميع مفاتيح ElevenLabs
UPDATE public.elevenlabs_keys 
SET is_active = true 
WHERE is_active = false;
