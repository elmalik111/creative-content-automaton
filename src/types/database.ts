export type JobType = 'merge' | 'ai_generate';
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

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
