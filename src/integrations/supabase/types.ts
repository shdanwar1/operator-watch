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
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      calendar_classes: {
        Row: {
          created_at: string
          dmc_class_id: string | null
          dmc_instructor_id: string | null
          end_time: string
          id: string
          operator: string
          scheduled_shift_id: string | null
          specific_date: string
          start_time: string
          status: string
          uid: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          dmc_class_id?: string | null
          dmc_instructor_id?: string | null
          end_time: string
          id?: string
          operator: string
          scheduled_shift_id?: string | null
          specific_date: string
          start_time: string
          status?: string
          uid: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          dmc_class_id?: string | null
          dmc_instructor_id?: string | null
          end_time?: string
          id?: string
          operator?: string
          scheduled_shift_id?: string | null
          specific_date?: string
          start_time?: string
          status?: string
          uid?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_classes_dmc_class_id_fkey"
            columns: ["dmc_class_id"]
            isOneToOne: false
            referencedRelation: "dmc_classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_classes_dmc_instructor_id_fkey"
            columns: ["dmc_instructor_id"]
            isOneToOne: false
            referencedRelation: "dmc_instructors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_classes_scheduled_shift_id_fkey"
            columns: ["scheduled_shift_id"]
            isOneToOne: false
            referencedRelation: "scheduled_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      deleted_shift_events: {
        Row: {
          created_at: string
          external_event_id: string
          id: string
          operator_name: string
          specific_date: string | null
        }
        Insert: {
          created_at?: string
          external_event_id: string
          id?: string
          operator_name: string
          specific_date?: string | null
        }
        Update: {
          created_at?: string
          external_event_id?: string
          id?: string
          operator_name?: string
          specific_date?: string | null
        }
        Relationships: []
      }
      dmc_classes: {
        Row: {
          category: string | null
          class_name: string
          created_at: string
          description: string | null
          id: string
          level: string | null
          source_class_id: string
          trailer_id: string | null
          updated_at: string
        }
        Insert: {
          category?: string | null
          class_name: string
          created_at?: string
          description?: string | null
          id?: string
          level?: string | null
          source_class_id: string
          trailer_id?: string | null
          updated_at?: string
        }
        Update: {
          category?: string | null
          class_name?: string
          created_at?: string
          description?: string | null
          id?: string
          level?: string | null
          source_class_id?: string
          trailer_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      dmc_instructors: {
        Row: {
          bio_info: string | null
          created_at: string
          first_name: string | null
          id: string
          image_url: string | null
          last_name: string | null
          source_instructor_id: string
          title: string | null
          updated_at: string
        }
        Insert: {
          bio_info?: string | null
          created_at?: string
          first_name?: string | null
          id?: string
          image_url?: string | null
          last_name?: string | null
          source_instructor_id: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          bio_info?: string | null
          created_at?: string
          first_name?: string | null
          id?: string
          image_url?: string | null
          last_name?: string | null
          source_instructor_id?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      dmc_timetable_slots: {
        Row: {
          active: boolean
          created_at: string
          day_local: number
          duration_minutes: number
          id: string
          resumes_on: string | null
          schedule_key: string
          source_class_id: string
          source_instructor_id: string
          source_slot_id: string
          start_time_local: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          day_local: number
          duration_minutes: number
          id?: string
          resumes_on?: string | null
          schedule_key: string
          source_class_id: string
          source_instructor_id: string
          source_slot_id: string
          start_time_local: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          day_local?: number
          duration_minutes?: number
          id?: string
          resumes_on?: string | null
          schedule_key?: string
          source_class_id?: string
          source_instructor_id?: string
          source_slot_id?: string
          start_time_local?: string
          updated_at?: string
        }
        Relationships: []
      }
      operator_travel_plans: {
        Row: {
          algorithm_version: number
          arrival_at: string
          calculated_at: string
          created_at: string
          departure_at: string
          id: string
          operator_id: string
          route_label: string | null
          shift_end_at: string | null
          shift_id: string | null
          shift_start_at: string
          transfers: number
          travel_minutes: number
          updated_at: string
        }
        Insert: {
          algorithm_version?: number
          arrival_at: string
          calculated_at?: string
          created_at?: string
          departure_at: string
          id?: string
          operator_id: string
          route_label?: string | null
          shift_end_at?: string | null
          shift_id?: string | null
          shift_start_at: string
          transfers?: number
          travel_minutes: number
          updated_at?: string
        }
        Update: {
          algorithm_version?: number
          arrival_at?: string
          calculated_at?: string
          created_at?: string
          departure_at?: string
          id?: string
          operator_id?: string
          route_label?: string | null
          shift_end_at?: string | null
          shift_id?: string | null
          shift_start_at?: string
          transfers?: number
          travel_minutes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "operator_travel_plans_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_travel_plans_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_travel_plans_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "scheduled_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      operators: {
        Row: {
          calendar_ics_url: string | null
          calendar_last_sync_at: string | null
          created_at: string
          home_label: string | null
          home_lat: number | null
          home_lng: number | null
          id: string
          is_active: boolean
          is_admin: boolean
          pin_hash: string | null
          prefs: Json
          updated_at: string
          username: string
        }
        Insert: {
          calendar_ics_url?: string | null
          calendar_last_sync_at?: string | null
          created_at?: string
          home_label?: string | null
          home_lat?: number | null
          home_lng?: number | null
          id?: string
          is_active?: boolean
          is_admin?: boolean
          pin_hash?: string | null
          prefs?: Json
          updated_at?: string
          username: string
        }
        Update: {
          calendar_ics_url?: string | null
          calendar_last_sync_at?: string | null
          created_at?: string
          home_label?: string | null
          home_lat?: number | null
          home_lng?: number | null
          id?: string
          is_active?: boolean
          is_admin?: boolean
          pin_hash?: string | null
          prefs?: Json
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      push_notification_deliveries: {
        Row: {
          attempts: number
          created_at: string
          devices_failed: number
          devices_sent: number
          expires_at: string | null
          id: string
          last_attempt_at: string | null
          last_error: string | null
          locked_at: string | null
          notification_key: string
          notification_type: string
          operator_id: string
          scheduled_at: string
          sent_at: string | null
          status: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          devices_failed?: number
          devices_sent?: number
          expires_at?: string | null
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          locked_at?: string | null
          notification_key: string
          notification_type: string
          operator_id: string
          scheduled_at: string
          sent_at?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          devices_failed?: number
          devices_sent?: number
          expires_at?: string | null
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          locked_at?: string | null
          notification_key?: string
          notification_type?: string
          operator_id?: string
          scheduled_at?: string
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_notification_deliveries_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_notification_deliveries_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators_public"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          disabled_at: string | null
          endpoint: string
          id: string
          last_seen_at: string
          operator_id: string
          p256dh: string
          platform: string | null
          user_agent: string | null
        }
        Insert: {
          auth: string
          created_at?: string
          disabled_at?: string | null
          endpoint: string
          id?: string
          last_seen_at?: string
          operator_id: string
          p256dh: string
          platform?: string | null
          user_agent?: string | null
        }
        Update: {
          auth?: string
          created_at?: string
          disabled_at?: string | null
          endpoint?: string
          id?: string
          last_seen_at?: string
          operator_id?: string
          p256dh?: string
          platform?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_subscriptions_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators_public"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_shifts: {
        Row: {
          assigned_operator: string | null
          created_at: string
          day_of_week: number | null
          end_time: string
          external_event_id: string | null
          id: string
          label: string | null
          notes: string | null
          specific_date: string
          start_time: string
          status: string
        }
        Insert: {
          assigned_operator?: string | null
          created_at?: string
          day_of_week?: number | null
          end_time: string
          external_event_id?: string | null
          id?: string
          label?: string | null
          notes?: string | null
          specific_date: string
          start_time: string
          status?: string
        }
        Update: {
          assigned_operator?: string | null
          created_at?: string
          day_of_week?: number | null
          end_time?: string
          external_event_id?: string | null
          id?: string
          label?: string | null
          notes?: string | null
          specific_date?: string
          start_time?: string
          status?: string
        }
        Relationships: []
      }
      shifts: {
        Row: {
          check_in_at: string
          check_out_at: string | null
          checklists: Json | null
          classes: Json
          created_at: string
          id: string
          live_streams_count: number
          notes: string | null
          operator_name: string
          scheduled_shift_id: string | null
        }
        Insert: {
          check_in_at?: string
          check_out_at?: string | null
          checklists?: Json | null
          classes?: Json
          created_at?: string
          id?: string
          live_streams_count?: number
          notes?: string | null
          operator_name: string
          scheduled_shift_id?: string | null
        }
        Update: {
          check_in_at?: string
          check_out_at?: string | null
          checklists?: Json | null
          classes?: Json
          created_at?: string
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
        Args: { p_id: string; p_pin?: string; p_username?: string }
        Returns: undefined
      }
      apply_checklist_item: {
        Args: { p_item_id: string; p_items: Json; p_patch: Json }
        Returns: Json
      }
      claim_push_delivery: {
        Args: {
          p_expires_at: string
          p_key: string
          p_max_attempts?: number
          p_operator_id: string
          p_scheduled_at: string
          p_stale_after?: string
          p_type: string
        }
        Returns: {
          attempts: number
          id: string
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
      push_dispatch_due: { Args: never; Returns: boolean }
      rename_operator: {
        Args: { p_id: string; p_username: string }
        Returns: undefined
      }
      set_operator_home: {
        Args: { p_id: string; p_label: string; p_lat: number; p_lng: number }
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
      set_shift_checklist_item: {
        Args: {
          p_class_id: string
          p_completed: boolean
          p_completed_at: string
          p_item_id: string
          p_operator: string
          p_section: string
          p_shift_id: string
        }
        Returns: Json
      }
      set_site_password: { Args: { p_pw: string }; Returns: undefined }
      update_shift_checklists_cas: {
        Args: { p_expected: Json; p_next: Json; p_shift_id: string }
        Returns: Json
      }
      verify_operator_pin: {
        Args: { p_pin: string; p_username: string }
        Returns: string
      }
      verify_site_password: { Args: { p_pw: string }; Returns: boolean }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
