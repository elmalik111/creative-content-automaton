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
      elevenlabs_keys: {
        Row: {
          api_key: string
          created_at: string
          id: string
          is_active: boolean
          last_used_at: string | null
          name: string
          usage_count: number
        }
        Insert: {
          api_key: string
          created_at?: string
          id?: string
          is_active?: boolean
          last_used_at?: string | null
          name: string
          usage_count?: number
        }
        Update: {
          api_key?: string
          created_at?: string
          id?: string
          is_active?: boolean
          last_used_at?: string | null
          name?: string
          usage_count?: number
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
        }
        Relationships: []
      }
      settings: {
        Row: {
          id: string
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
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
      job_status: ["pending", "processing", "completed", "failed"],
      job_type: ["merge", "ai_generate"],
    },
  },
} as const
