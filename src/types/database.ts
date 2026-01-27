export type JobType = 'merge' | 'ai_generate';
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type OAuthPlatform = 'youtube' | 'instagram' | 'facebook';

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  progress: number;
  source_url: string | null;
  callback_url: string | null;
  input_data: unknown | null;
  output_url: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobStep {
  id: string;
  job_id: string;
  step_name: string;
  step_order: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  started_at: string | null;
  completed_at: string | null;
  output_data: unknown | null;
  error_message: string | null;
  created_at: string;
}

export interface ElevenLabsKey {
  id: string;
  api_key: string;
  name: string;
  usage_count: number;
  last_used_at: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Setting {
  id: string;
  key: string;
  value: string;
  updated_at: string;
}

export interface OAuthToken {
  id: string;
  platform: OAuthPlatform;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  scope: string | null;
  account_name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ApiKey {
  id: string;
  name: string;
  key: string;
  is_active: boolean;
  last_used_at: string | null;
  usage_count: number;
  created_at: string;
}
