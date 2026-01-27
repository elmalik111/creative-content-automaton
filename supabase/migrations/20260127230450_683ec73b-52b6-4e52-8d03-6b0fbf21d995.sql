-- Add job_steps table for detailed job tracking
CREATE TABLE public.job_steps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  step_name TEXT NOT NULL,
  step_order INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  output_data JSONB,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create index for job steps
CREATE INDEX idx_job_steps_job_id ON public.job_steps(job_id);

-- Enable RLS
ALTER TABLE public.job_steps ENABLE ROW LEVEL SECURITY;

-- RLS policies for job_steps
CREATE POLICY "Allow public read for job_steps" ON public.job_steps FOR SELECT USING (true);
CREATE POLICY "Allow public insert for job_steps" ON public.job_steps FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update for job_steps" ON public.job_steps FOR UPDATE USING (true);
CREATE POLICY "Allow public delete for job_steps" ON public.job_steps FOR DELETE USING (true);

-- Add oauth_tokens table for social platform authentication
CREATE TABLE public.oauth_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('youtube', 'instagram', 'facebook')),
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TIMESTAMP WITH TIME ZONE,
  scope TEXT,
  account_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create unique constraint for platform
CREATE UNIQUE INDEX idx_oauth_tokens_platform ON public.oauth_tokens(platform) WHERE is_active = true;

-- Enable RLS
ALTER TABLE public.oauth_tokens ENABLE ROW LEVEL SECURITY;

-- RLS policies for oauth_tokens
CREATE POLICY "Allow public read for oauth_tokens" ON public.oauth_tokens FOR SELECT USING (true);
CREATE POLICY "Allow public insert for oauth_tokens" ON public.oauth_tokens FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update for oauth_tokens" ON public.oauth_tokens FOR UPDATE USING (true);
CREATE POLICY "Allow public delete for oauth_tokens" ON public.oauth_tokens FOR DELETE USING (true);

-- Add trigger for updated_at
CREATE TRIGGER update_oauth_tokens_updated_at
BEFORE UPDATE ON public.oauth_tokens
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add api_keys table for external API access
CREATE TABLE public.api_keys (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  key TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_used_at TIMESTAMP WITH TIME ZONE,
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

-- RLS policies for api_keys
CREATE POLICY "Allow public read for api_keys" ON public.api_keys FOR SELECT USING (true);
CREATE POLICY "Allow public insert for api_keys" ON public.api_keys FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update for api_keys" ON public.api_keys FOR UPDATE USING (true);
CREATE POLICY "Allow public delete for api_keys" ON public.api_keys FOR DELETE USING (true);