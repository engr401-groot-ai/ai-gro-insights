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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      chat_conversations: {
        Row: {
          created_at: string | null
          id: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          content: string
          conversation_id: string | null
          created_at: string | null
          id: string
          role: string
          sources: Json | null
        }
        Insert: {
          content: string
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          role: string
          sources?: Json | null
        }
        Update: {
          content?: string
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          role?: string
          sources?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      search_queries: {
        Row: {
          created_at: string | null
          id: string
          query_text: string
          query_type: string | null
          results_count: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          query_text: string
          query_type?: string | null
          results_count?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          query_text?: string
          query_type?: string | null
          results_count?: number | null
        }
        Relationships: []
      }
      transcript_segments: {
        Row: {
          created_at: string | null
          embedding: string | null
          end_time: number
          id: string
          segment_text: string
          start_time: number
          transcription_id: string | null
          video_id: string | null
        }
        Insert: {
          created_at?: string | null
          embedding?: string | null
          end_time: number
          id?: string
          segment_text: string
          start_time: number
          transcription_id?: string | null
          video_id?: string | null
        }
        Update: {
          created_at?: string | null
          embedding?: string | null
          end_time?: number
          id?: string
          segment_text?: string
          start_time?: number
          transcription_id?: string | null
          video_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transcript_segments_transcription_id_fkey"
            columns: ["transcription_id"]
            isOneToOne: false
            referencedRelation: "transcriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transcript_segments_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      transcriptions: {
        Row: {
          created_at: string | null
          full_text: string
          id: string
          language: string | null
          video_id: string | null
        }
        Insert: {
          created_at?: string | null
          full_text: string
          id?: string
          language?: string | null
          video_id?: string | null
        }
        Update: {
          created_at?: string | null
          full_text?: string
          id?: string
          language?: string | null
          video_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transcriptions_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      videos: {
        Row: {
          channel_id: string | null
          created_at: string | null
          description: string | null
          duration: number | null
          id: string
          published_at: string
          status: string | null
          thumbnail_url: string | null
          title: string
          updated_at: string | null
          url: string
          youtube_id: string
        }
        Insert: {
          channel_id?: string | null
          created_at?: string | null
          description?: string | null
          duration?: number | null
          id?: string
          published_at: string
          status?: string | null
          thumbnail_url?: string | null
          title: string
          updated_at?: string | null
          url: string
          youtube_id: string
        }
        Update: {
          channel_id?: string | null
          created_at?: string | null
          description?: string | null
          duration?: number | null
          id?: string
          published_at?: string
          status?: string | null
          thumbnail_url?: string | null
          title?: string
          updated_at?: string | null
          url?: string
          youtube_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "videos_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "youtube_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      youtube_channels: {
        Row: {
          channel_id: string
          channel_name: string
          channel_url: string
          created_at: string | null
          id: string
          last_sync_at: string | null
          updated_at: string | null
        }
        Insert: {
          channel_id: string
          channel_name: string
          channel_url: string
          created_at?: string | null
          id?: string
          last_sync_at?: string | null
          updated_at?: string | null
        }
        Update: {
          channel_id?: string
          channel_name?: string
          channel_url?: string
          created_at?: string | null
          id?: string
          last_sync_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      search_transcript_segments: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          channel_name: string
          end_time: number
          id: string
          published_at: string
          segment_text: string
          similarity: number
          start_time: number
          video_id: string
          video_title: string
          video_url: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
