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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      classes: {
        Row: {
          created_at: string
          id: string
          last_used_at: string | null
          name: string
          usage_count: number
        }
        Insert: {
          created_at?: string
          id?: string
          last_used_at?: string | null
          name: string
          usage_count?: number
        }
        Update: {
          created_at?: string
          id?: string
          last_used_at?: string | null
          name?: string
          usage_count?: number
        }
        Relationships: []
      }
      operators: {
        Row: {
          calendar_ics_url: string | null
          created_at: string
          home_label: string | null
          home_lat: number | null
          home_lng: number | null
          id: string
          is_active: boolean
          is_admin: boolean
          magic_word_hash: string | null
          pin_hash: string | null
          updated_at: string
          username: string
        }
        Insert: {
          calendar_ics_url?: string | null
          created_at?: string
          home_label?: string | null
          home_lat?: number | null
          home_lng?: number | null
          id?: string
          is_active?: boolean
          is_admin?: boolean
          magic_word_hash?: string | null
          pin_hash?: string | null
          updated_at?: string
          username: string
        }
        Update: {
          calendar_ics_url?: string | null
          created_at?: string
          home_label?: string | null
          home_lat?: number | null
          home_lng?: number | null
          id?: string
          is_active?: boolean
          is_admin?: boolean
          magic_word_hash?: string | null
          pin_hash?: string | null
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      scheduled_shifts: {
        Row: {
          assigned_operator: string | null
          created_at: string
          day_of_week: number
          end_time: string
          external_event_id: string | null
          id: string
          label: string | null
          notes: string | null
          specific_date: string | null
          start_time: string
          status: string
        }
        Insert: {
          assigned_operator?: string | null
          created_at?: string
          day_of_week: number
          end_time: string
          external_event_id?: string | null
          id?: string
          label?: string | null
          notes?: string | null
          specific_date?: string | null
          start_time: string
          status?: string
        }
        Update: {
          assigned_operator?: string | null
          created_at?: string
          day_of_week?: number
          end_time?: string
          external_event_id?: string | null
          id?: string
          label?: string | null
          notes?: string | null
          specific_date?: string | null
          start_time?: string
          status?: string
        }
        Relationships: []
      }
      shifts: {
        Row: {
          check_in_at: string
          check_out_at: string | null
          classes: Json
          created_at: string
          dance_teachers: string[]
          id: string
          live_streams_count: number
          notes: string | null
          operator_name: string
          scheduled_shift_id: string | null
        }
        Insert: {
          check_in_at?: string
          check_out_at?: string | null
          classes?: Json
          created_at?: string
          dance_teachers?: string[]
          id?: string
          live_streams_count?: number
          notes?: string | null
          operator_name: string
          scheduled_shift_id?: string | null
        }
        Update: {
          check_in_at?: string
          check_out_at?: string | null
          classes?: Json
          created_at?: string
          dance_teachers?: string[]
          id?: string
          live_streams_count?: number
          notes?: string | null
          operator_name?: string
          scheduled_shift_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shifts_scheduled_shift_id_fkey"
            columns: ["scheduled_shift_id"]
            isOneToOne: false
            referencedRelation: "scheduled_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      teachers: {
        Row: {
          created_at: string
          id: string
          last_used_at: string | null
          name: string
          usage_count: number
        }
        Insert: {
          created_at?: string
          id?: string
          last_used_at?: string | null
          name: string
          usage_count?: number
        }
        Update: {
          created_at?: string
          id?: string
          last_used_at?: string | null
          name?: string
          usage_count?: number
        }
        Relationships: []
      }
    }
    Views: {
      operators_public: {
        Row: {
          created_at: string | null
          id: string | null
          is_admin: boolean | null
          updated_at: string | null
          username: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          is_admin?: boolean | null
          updated_at?: string | null
          username?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          is_admin?: boolean | null
          updated_at?: string | null
          username?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_create_operator: {
        Args: { p_pin: string; p_username: string }
        Returns: string
      }
      admin_set_operator_active: {
        Args: { p_active: boolean; p_id: string }
        Returns: undefined
      }
      admin_update_operator: {
        Args: {
          p_id: string
          p_magic?: string
          p_pin?: string
          p_username?: string
        }
        Returns: undefined
      }
      find_operator_by_magic: {
        Args: { p_magic: string }
        Returns: {
          id: string
          username: string
        }[]
      }
      list_operators_for_selection: {
        Args: never
        Returns: {
          id: string
          is_admin: boolean
          username: string
        }[]
      }
      set_operator_home: {
        Args: { p_id: string; p_label: string; p_lat: number; p_lng: number }
        Returns: undefined
      }
      set_operator_magic: {
        Args: { p_id: string; p_magic: string }
        Returns: undefined
      }
      set_operator_pin: {
        Args: { p_id: string; p_pin: string }
        Returns: undefined
      }
      set_operator_username: {
        Args: { p_id: string; p_username: string }
        Returns: undefined
      }
      verify_operator_magic: {
        Args: { p_magic: string; p_username: string }
        Returns: string
      }
      verify_operator_pin: {
        Args: { p_pin: string; p_username: string }
        Returns: string
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
