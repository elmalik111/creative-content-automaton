export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      ai_content: {
        Row: {
          content: Json
          created_at: string | null
          id: string
          prompt: string
          status: string
          type: string
          user_id: string
        }
        Insert: {
          content: Json
          created_at?: string | null
          id?: string
          prompt: string
          status?: string
          type: string
          user_id: string
        }
        Update: {
          content?: Json
          created_at?: string | null
          id?: string
          prompt?: string
          status?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      api_keys: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          key: string
          last_used_at: string | null
          name: string
          usage_count: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          key: string
          last_used_at?: string | null
          name: string
          usage_count?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          key?: string
          last_used_at?: string | null
          name?: string
          usage_count?: number
        }
        Relationships: []
      }
      connections: {
        Row: {
          access_token: string
          created_at: string | null
          expires_at: string | null
          id: string
          platform: string
          platform_account_id: string | null
          platform_account_name: string | null
          refresh_token: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          platform: string
          platform_account_id?: string | null
          platform_account_name?: string | null
          refresh_token?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          platform?: string
          platform_account_id?: string | null
          platform_account_name?: string | null
          refresh_token?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      elevenlabs_key_logs: {
        Row: {
          audio_size_bytes: number | null
          error_message: string | null
          id: string
          key_id: string
          response_time_ms: number | null
          success: boolean
          text_length: number | null
          timestamp: string | null
        }
        Insert: {
          audio_size_bytes?: number | null
          error_message?: string | null
          id?: string
          key_id: string
          response_time_ms?: number | null
          success: boolean
          text_length?: number | null
          timestamp?: string | null
        }
        Update: {
          audio_size_bytes?: number | null
          error_message?: string | null
          id?: string
          key_id?: string
          response_time_ms?: number | null
          success?: boolean
          text_length?: number | null
          timestamp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_key"
            columns: ["key_id"]
            isOneToOne: false
            referencedRelation: "elevenlabs_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_key"
            columns: ["key_id"]
            isOneToOne: false
            referencedRelation: "elevenlabs_keys_stats"
            referencedColumns: ["id"]
          },
        ]
      }
      elevenlabs_keys: {
        Row: {
          api_key: string
          character_count: number | null
          character_limit: number | null
          consecutive_failures: number | null
          cooldown_until: string | null
          created_at: string
          deactivated_at: string | null
          deactivation_reason: string | null
          id: string
          is_active: boolean
          last_used_at: string | null
          last_validation_at: string | null
          name: string
          reactivated_at: string | null
          usage_count: number
          user_id: string | null
        }
        Insert: {
          api_key: string
          character_count?: number | null
          character_limit?: number | null
          consecutive_failures?: number | null
          cooldown_until?: string | null
          created_at?: string
          deactivated_at?: string | null
          deactivation_reason?: string | null
          id?: string
          is_active?: boolean
          last_used_at?: string | null
          last_validation_at?: string | null
          name: string
          reactivated_at?: string | null
          usage_count?: number
          user_id?: string | null
        }
        Update: {
          api_key?: string
          character_count?: number | null
          character_limit?: number | null
          consecutive_failures?: number | null
          cooldown_until?: string | null
          created_at?: string
          deactivated_at?: string | null
          deactivation_reason?: string | null
          id?: string
          is_active?: boolean
          last_used_at?: string | null
          last_validation_at?: string | null
          name?: string
          reactivated_at?: string | null
          usage_count?: number
          user_id?: string | null
        }
        Relationships: []
      }
      ideas: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          status: string
          title: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          status?: string
          title: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          status?: string
          title?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      job_steps: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          job_id: string
          output_data: Json | null
          started_at: string | null
          status: string
          step_name: string
          step_order: number
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          job_id: string
          output_data?: Json | null
          started_at?: string | null
          status?: string
          step_name: string
          step_order: number
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          job_id?: string
          output_data?: Json | null
          started_at?: string | null
          status?: string
          step_name?: string
          step_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "job_steps_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          callback_url: string | null
          created_at: string
          error_message: string | null
          id: string
          input_data: Json | null
          output_url: string | null
          platforms: string[] | null
          progress: number
          source_url: string | null
          status: Database["public"]["Enums"]["job_status"]
          type: Database["public"]["Enums"]["job_type"]
          updated_at: string
        }
        Insert: {
          callback_url?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          input_data?: Json | null
          output_url?: string | null
          platforms?: string[] | null
          progress?: number
          source_url?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          type: Database["public"]["Enums"]["job_type"]
          updated_at?: string
        }
        Update: {
          callback_url?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          input_data?: Json | null
          output_url?: string | null
          platforms?: string[] | null
          progress?: number
          source_url?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          type?: Database["public"]["Enums"]["job_type"]
          updated_at?: string
        }
        Relationships: []
      }
      oauth_tokens: {
        Row: {
          access_token: string
          account_name: string | null
          created_at: string
          expires_at: string | null
          id: string
          is_active: boolean
          platform: string
          refresh_token: string | null
          scope: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          access_token: string
          account_name?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          platform: string
          refresh_token?: string | null
          scope?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          access_token?: string
          account_name?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          platform?: string
          refresh_token?: string | null
          scope?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      pollinations_keys: {
        Row: {
          api_key: string
          consecutive_failures: number
          cooldown_until: string | null
          created_at: string
          deactivated_at: string | null
          deactivation_reason: string | null
          id: string
          is_active: boolean
          last_used_at: string | null
          name: string
          usage_count: number
          user_id: string | null
        }
        Insert: {
          api_key: string
          consecutive_failures?: number
          cooldown_until?: string | null
          created_at?: string
          deactivated_at?: string | null
          deactivation_reason?: string | null
          id?: string
          is_active?: boolean
          last_used_at?: string | null
          name: string
          usage_count?: number
          user_id?: string | null
        }
        Update: {
          api_key?: string
          consecutive_failures?: number
          cooldown_until?: string | null
          created_at?: string
          deactivated_at?: string | null
          deactivation_reason?: string | null
          id?: string
          is_active?: boolean
          last_used_at?: string | null
          name?: string
          usage_count?: number
          user_id?: string | null
        }
        Relationships: []
      }
      posts: {
        Row: {
          content: string
          created_at: string | null
          id: string
          media_urls: string[] | null
          platform_post_ids: Json | null
          platform_targets: string[]
          scheduled_at: string | null
          status: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          media_urls?: string[] | null
          platform_post_ids?: Json | null
          platform_targets: string[]
          scheduled_at?: string | null
          status?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          media_urls?: string[] | null
          platform_post_ids?: Json | null
          platform_targets?: string[]
          scheduled_at?: string | null
          status?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string
          full_name: string | null
          id: string
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email: string
          full_name?: string | null
          id: string
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string
          full_name?: string | null
          id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      settings: {
        Row: {
          id: string
          key: string
          updated_at: string
          user_id: string | null
          value: string
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string
          user_id?: string | null
          value: string
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string
          user_id?: string | null
          value?: string
        }
        Relationships: []
      }
      telegram_chat_users: {
        Row: {
          chat_id: number
          created_at: string | null
          first_name: string | null
          id: string
          updated_at: string | null
          user_id: string | null
          username: string | null
        }
        Insert: {
          chat_id: number
          created_at?: string | null
          first_name?: string | null
          id?: string
          updated_at?: string | null
          user_id?: string | null
          username?: string | null
        }
        Update: {
          chat_id?: number
          created_at?: string | null
          first_name?: string | null
          id?: string
          updated_at?: string | null
          user_id?: string | null
          username?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      elevenlabs_keys_stats: {
        Row: {
          character_count: number | null
          character_limit: number | null
          failed_requests: number | null
          id: string | null
          is_active: boolean | null
          last_request_at: string | null
          last_used_at: string | null
          name: string | null
          success_rate: number | null
          successful_requests: number | null
          total_requests: number | null
          usage_count: number | null
          usage_percentage: number | null
        }
        Relationships: []
      }
      elevenlabs_recent_errors: {
        Row: {
          error_message: string | null
          id: string | null
          key_name: string | null
          text_length: number | null
          timestamp: string | null
        }
        Relationships: []
      }
      oauth_tokens_safe: {
        Row: {
          account_name: string | null
          created_at: string | null
          expires_at: string | null
          id: string | null
          is_active: boolean | null
          platform: string | null
          scope: string | null
          updated_at: string | null
        }
        Insert: {
          account_name?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string | null
          is_active?: boolean | null
          platform?: string | null
          scope?: string | null
          updated_at?: string | null
        }
        Update: {
          account_name?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string | null
          is_active?: boolean | null
          platform?: string | null
          scope?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          id: string | null
          key: string | null
          updated_at: string | null
          user_id: string | null
          value: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      cleanup_expired_cooldowns: { Args: never; Returns: undefined }
      cleanup_old_elevenlabs_logs: { Args: never; Returns: number }
      get_best_elevenlabs_key: {
        Args: never
        Returns: {
          api_key: string
          key_id: string
          key_name: string
          success_rate: number
          usage_count: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      save_user_setting: {
        Args: { p_key: string; p_value: string }
        Returns: undefined
      }
      upsert_user_setting: {
        Args: { p_key: string; p_value: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "user"
      job_status: "pending" | "processing" | "completed" | "failed"
      job_type: "merge" | "ai_generate"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
      job_status: ["pending", "processing", "completed", "failed"],
      job_type: ["merge", "ai_generate"],
    },
  },
} as const
