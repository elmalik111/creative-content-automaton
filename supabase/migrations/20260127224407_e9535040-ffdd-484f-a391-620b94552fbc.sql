-- Create job_type enum
CREATE TYPE public.job_type AS ENUM ('merge', 'ai_generate');

-- Create job_status enum
CREATE TYPE public.job_status AS ENUM ('pending', 'processing', 'completed', 'failed');

-- Create jobs table
CREATE TABLE public.jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  type job_type NOT NULL,
  status job_status NOT NULL DEFAULT 'pending',
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  source_url TEXT,
  callback_url TEXT,
  input_data JSONB,
  output_url TEXT,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create elevenlabs_keys table
CREATE TABLE public.elevenlabs_keys (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  api_key TEXT NOT NULL,
  name TEXT NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create settings table
CREATE TABLE public.settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Add triggers for updated_at
CREATE TRIGGER update_jobs_updated_at
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_settings_updated_at
  BEFORE UPDATE ON public.settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS on all tables
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.elevenlabs_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for jobs (public access since site is private)
CREATE POLICY "Allow all access to jobs"
  ON public.jobs
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Create RLS policies for elevenlabs_keys
CREATE POLICY "Allow all access to elevenlabs_keys"
  ON public.elevenlabs_keys
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Create RLS policies for settings
CREATE POLICY "Allow all access to settings"
  ON public.settings
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Create storage buckets
INSERT INTO storage.buckets (id, name, public) VALUES ('media-input', 'media-input', true);
INSERT INTO storage.buckets (id, name, public) VALUES ('media-output', 'media-output', true);
INSERT INTO storage.buckets (id, name, public) VALUES ('temp-files', 'temp-files', false);

-- Storage policies for media-input bucket
CREATE POLICY "Public read access for media-input"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'media-input');

CREATE POLICY "Allow uploads to media-input"
  ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'media-input');

CREATE POLICY "Allow updates to media-input"
  ON storage.objects
  FOR UPDATE
  USING (bucket_id = 'media-input');

CREATE POLICY "Allow deletes from media-input"
  ON storage.objects
  FOR DELETE
  USING (bucket_id = 'media-input');

-- Storage policies for media-output bucket
CREATE POLICY "Public read access for media-output"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'media-output');

CREATE POLICY "Allow uploads to media-output"
  ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'media-output');

CREATE POLICY "Allow updates to media-output"
  ON storage.objects
  FOR UPDATE
  USING (bucket_id = 'media-output');

CREATE POLICY "Allow deletes from media-output"
  ON storage.objects
  FOR DELETE
  USING (bucket_id = 'media-output');

-- Storage policies for temp-files bucket
CREATE POLICY "Allow all access to temp-files"
  ON storage.objects
  FOR ALL
  USING (bucket_id = 'temp-files')
  WITH CHECK (bucket_id = 'temp-files');

-- Create indexes for better performance
CREATE INDEX idx_jobs_status ON public.jobs(status);
CREATE INDEX idx_jobs_type ON public.jobs(type);
CREATE INDEX idx_jobs_created_at ON public.jobs(created_at DESC);
CREATE INDEX idx_elevenlabs_keys_active ON public.elevenlabs_keys(is_active) WHERE is_active = true;
CREATE INDEX idx_elevenlabs_keys_usage ON public.elevenlabs_keys(usage_count ASC) WHERE is_active = true;