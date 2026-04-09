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
      ad_campaigns: {
        Row: {
          bid_strategy_details: Json | null
          bidding_strategy_type: string | null
          campaign_name: string
          campaign_type: string | null
          clicks: number
          client_id: string
          conversions: number
          created_at: string
          daily_budget: number | null
          date: string
          id: string
          impression_share: number | null
          impressions: number
          platform: string
          revenue: number
          roas: number | null
          spend: number
          status: string | null
        }
        Insert: {
          bid_strategy_details?: Json | null
          bidding_strategy_type?: string | null
          campaign_name: string
          campaign_type?: string | null
          clicks?: number
          client_id: string
          conversions?: number
          created_at?: string
          daily_budget?: number | null
          date: string
          id?: string
          impression_share?: number | null
          impressions?: number
          platform: string
          revenue?: number
          roas?: number | null
          spend?: number
          status?: string | null
        }
        Update: {
          bid_strategy_details?: Json | null
          bidding_strategy_type?: string | null
          campaign_name?: string
          campaign_type?: string | null
          clicks?: number
          client_id?: string
          conversions?: number
          created_at?: string
          daily_budget?: number | null
          date?: string
          id?: string
          impression_share?: number | null
          impressions?: number
          platform?: string
          revenue?: number
          roas?: number | null
          spend?: number
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_campaigns_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_daily_metrics: {
        Row: {
          add_to_cart: number
          clicks: number
          client_id: string
          conversions: number
          cost_per_conversion: number | null
          created_at: string
          date: string
          id: string
          impressions: number
          platform: string
          revenue: number
          spend: number
        }
        Insert: {
          add_to_cart?: number
          clicks?: number
          client_id: string
          conversions?: number
          cost_per_conversion?: number | null
          created_at?: string
          date: string
          id?: string
          impressions?: number
          platform: string
          revenue?: number
          spend?: number
        }
        Update: {
          add_to_cart?: number
          clicks?: number
          client_id?: string
          conversions?: number
          cost_per_conversion?: number | null
          created_at?: string
          date?: string
          id?: string
          impressions?: number
          platform?: string
          revenue?: number
          spend?: number
        }
        Relationships: [
          {
            foreignKeyName: "ad_daily_metrics_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      call_action_items: {
        Row: {
          assignee_id: string | null
          call_agenda_id: string
          completed: boolean
          created_at: string
          description: string
          due_date: string | null
          id: string
          task_id: string | null
        }
        Insert: {
          assignee_id?: string | null
          call_agenda_id: string
          completed?: boolean
          created_at?: string
          description: string
          due_date?: string | null
          id?: string
          task_id?: string | null
        }
        Update: {
          assignee_id?: string | null
          call_agenda_id?: string
          completed?: boolean
          created_at?: string
          description?: string
          due_date?: string | null
          id?: string
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_action_items_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_action_items_call_agenda_id_fkey"
            columns: ["call_agenda_id"]
            isOneToOne: false
            referencedRelation: "call_agendas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_action_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      call_agendas: {
        Row: {
          agenda_content: Json | null
          call_date: string
          call_type: string
          client_id: string
          created_at: string
          created_by_id: string | null
          id: string
          notes_content: Json | null
          published_at: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          agenda_content?: Json | null
          call_date: string
          call_type?: string
          client_id: string
          created_at?: string
          created_by_id?: string | null
          id?: string
          notes_content?: Json | null
          published_at?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          agenda_content?: Json | null
          call_date?: string
          call_type?: string
          client_id?: string
          created_at?: string
          created_by_id?: string | null
          id?: string
          notes_content?: Json | null
          published_at?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_agendas_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_agendas_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      client_assignments: {
        Row: {
          assigned_at: string
          assigned_by_id: string | null
          client_id: string
          id: string
          role_on_account: string | null
          team_member_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by_id?: string | null
          client_id: string
          id?: string
          role_on_account?: string | null
          team_member_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by_id?: string | null
          client_id?: string
          id?: string
          role_on_account?: string | null
          team_member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_assignments_assigned_by_id_fkey"
            columns: ["assigned_by_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_assignments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_assignments_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          color: string | null
          communication_channel: string | null
          created_at: string
          id: string
          logo_url: string | null
          name: string
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          color?: string | null
          communication_channel?: string | null
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          color?: string | null
          communication_channel?: string | null
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      context_items: {
        Row: {
          client_id: string
          content: string | null
          content_type: string
          created_at: string
          id: string
          metadata: Json | null
          occurred_at: string
          participants: string[] | null
          source: string
          source_id: string | null
          title: string | null
        }
        Insert: {
          client_id: string
          content?: string | null
          content_type: string
          created_at?: string
          id?: string
          metadata?: Json | null
          occurred_at?: string
          participants?: string[] | null
          source: string
          source_id?: string | null
          title?: string | null
        }
        Update: {
          client_id?: string
          content?: string | null
          content_type?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          occurred_at?: string
          participants?: string[] | null
          source?: string
          source_id?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "context_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      context_sync_log: {
        Row: {
          client_id: string
          created_at: string
          error_message: string | null
          id: string
          items_synced: number | null
          last_sync_at: string | null
          source: string
          status: string
        }
        Insert: {
          client_id: string
          created_at?: string
          error_message?: string | null
          id?: string
          items_synced?: number | null
          last_sync_at?: string | null
          source: string
          status?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          error_message?: string | null
          id?: string
          items_synced?: number | null
          last_sync_at?: string | null
          source?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "context_sync_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_briefs: {
        Row: {
          assigned_to_id: string | null
          brand_guidelines_url: string | null
          client_id: string
          copy_suggestions: Json | null
          created_at: string
          created_by_id: string | null
          creative_type: string
          due_date: string | null
          id: string
          key_message: string | null
          notes: string | null
          objective: string | null
          platforms: string[] | null
          priority: string
          reference_assets: Json | null
          status: string
          target_audience: string | null
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to_id?: string | null
          brand_guidelines_url?: string | null
          client_id: string
          copy_suggestions?: Json | null
          created_at?: string
          created_by_id?: string | null
          creative_type?: string
          due_date?: string | null
          id?: string
          key_message?: string | null
          notes?: string | null
          objective?: string | null
          platforms?: string[] | null
          priority?: string
          reference_assets?: Json | null
          status?: string
          target_audience?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to_id?: string | null
          brand_guidelines_url?: string | null
          client_id?: string
          copy_suggestions?: Json | null
          created_at?: string
          created_by_id?: string | null
          creative_type?: string
          due_date?: string | null
          id?: string
          key_message?: string | null
          notes?: string | null
          objective?: string | null
          platforms?: string[] | null
          priority?: string
          reference_assets?: Json | null
          status?: string
          target_audience?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_briefs_assigned_to_id_fkey"
            columns: ["assigned_to_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_briefs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_briefs_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_deliverables: {
        Row: {
          brief_id: string
          drive_url: string | null
          file_name: string
          file_size: number | null
          file_type: string | null
          file_url: string
          id: string
          uploaded_at: string
          uploaded_by_id: string | null
          version: number
        }
        Insert: {
          brief_id: string
          drive_url?: string | null
          file_name: string
          file_size?: number | null
          file_type?: string | null
          file_url: string
          id?: string
          uploaded_at?: string
          uploaded_by_id?: string | null
          version?: number
        }
        Update: {
          brief_id?: string
          drive_url?: string | null
          file_name?: string
          file_size?: number | null
          file_type?: string | null
          file_url?: string
          id?: string
          uploaded_at?: string
          uploaded_by_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "creative_deliverables_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "creative_briefs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_deliverables_uploaded_by_id_fkey"
            columns: ["uploaded_by_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_reviews: {
        Row: {
          action: string
          brief_id: string
          comments: string | null
          created_at: string
          id: string
          reviewer_id: string
        }
        Insert: {
          action: string
          brief_id: string
          comments?: string | null
          created_at?: string
          id?: string
          reviewer_id: string
        }
        Update: {
          action?: string
          brief_id?: string
          comments?: string | null
          created_at?: string
          id?: string
          reviewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_reviews_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "creative_briefs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_configs: {
        Row: {
          client_id: string
          created_at: string
          custom_metrics: Json | null
          enabled_kpis: string[]
          enabled_platforms: string[]
          id: string
          revenue_source: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          custom_metrics?: Json | null
          enabled_kpis?: string[]
          enabled_platforms?: string[]
          id?: string
          revenue_source?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          custom_metrics?: Json | null
          enabled_kpis?: string[]
          enabled_platforms?: string[]
          id?: string
          revenue_source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_configs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      landing_pages: {
        Row: {
          client_id: string
          created_at: string
          created_by_id: string | null
          id: string
          notes: string | null
          platform_source: string | null
          staging_url: string | null
          status: string
          title: string
          updated_at: string
          url: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by_id?: string | null
          id?: string
          notes?: string | null
          platform_source?: string | null
          staging_url?: string | null
          status?: string
          title: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by_id?: string | null
          id?: string
          notes?: string | null
          platform_source?: string | null
          staging_url?: string | null
          status?: string
          title?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "landing_pages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "landing_pages_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_connections: {
        Row: {
          access_token: string | null
          account_id: string | null
          account_name: string | null
          client_id: string
          created_at: string
          id: string
          metadata: Json | null
          platform: string
          refresh_token: string | null
          selected_ad_account: Json | null
          status: string
          token_expires_at: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          access_token?: string | null
          account_id?: string | null
          account_name?: string | null
          client_id: string
          created_at?: string
          id?: string
          metadata?: Json | null
          platform: string
          refresh_token?: string | null
          selected_ad_account?: Json | null
          status?: string
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          access_token?: string | null
          account_id?: string | null
          account_name?: string | null
          client_id?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          platform?: string
          refresh_token?: string | null
          selected_ad_account?: Json | null
          status?: string
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_connections_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      task_comments: {
        Row: {
          author_id: string
          content: string
          created_at: string
          id: string
          task_id: string
        }
        Insert: {
          author_id: string
          content: string
          created_at?: string
          id?: string
          task_id: string
        }
        Update: {
          author_id?: string
          content?: string
          created_at?: string
          id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_time_entries: {
        Row: {
          created_at: string
          description: string | null
          duration_minutes: number | null
          ended_at: string | null
          id: string
          started_at: string
          task_id: string
          team_member_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          ended_at?: string | null
          id?: string
          started_at?: string
          task_id: string
          team_member_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          ended_at?: string | null
          id?: string
          started_at?: string
          task_id?: string
          team_member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_time_entries_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_time_entries_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assignee_id: string | null
          client_id: string
          completed_at: string | null
          created_at: string
          created_by_id: string | null
          description: string | null
          due_date: string | null
          id: string
          parent_task_id: string | null
          position: number
          priority: string
          status: string
          tags: string[] | null
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          client_id: string
          completed_at?: string | null
          created_at?: string
          created_by_id?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          parent_task_id?: string | null
          position?: number
          priority?: string
          status?: string
          tags?: string[] | null
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          client_id?: string
          completed_at?: string | null
          created_at?: string
          created_by_id?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          parent_task_id?: string | null
          position?: number
          priority?: string
          status?: string
          tags?: string[] | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          id: string
          is_active: boolean
          name: string
          role: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          id?: string
          is_active?: boolean
          name: string
          role: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          id?: string
          is_active?: boolean
          name?: string
          role?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_team_member_id: { Args: { check_user_id: string }; Returns: string }
      has_client_access: {
        Args: { check_client_id: string; check_user_id: string }
        Returns: boolean
      }
      is_admin: { Args: { check_user_id: string }; Returns: boolean }
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
