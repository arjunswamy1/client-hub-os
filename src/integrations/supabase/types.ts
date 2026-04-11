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
          account_id: string | null
          add_to_cart: number | null
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
          account_id?: string | null
          add_to_cart?: number | null
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
          account_id?: string | null
          add_to_cart?: number | null
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
      ad_creatives: {
        Row: {
          ad_name: string | null
          adset_name: string | null
          campaign_name: string
          clicks: number | null
          client_id: string
          conversions: number | null
          cpa: number | null
          created_at: string | null
          creative_thumbnail_url: string | null
          creative_type: string | null
          cta: string | null
          ctr: number | null
          date_from: string | null
          date_to: string | null
          description: string | null
          descriptions: string[] | null
          display_url: string | null
          final_url: string | null
          format: string | null
          frequency: number | null
          headline: string | null
          headlines: string[] | null
          id: string
          impressions: number | null
          link_url: string | null
          platform: string
          platform_ad_id: string | null
          platform_adset_id: string | null
          platform_campaign_id: string | null
          primary_text: string | null
          revenue: number | null
          roas: number | null
          spend: number | null
          status: string | null
          updated_at: string | null
          vertical: string | null
          video_url: string | null
          video_views_25: number | null
          video_views_3s: number | null
          video_views_50: number | null
          video_views_95: number | null
        }
        Insert: {
          ad_name?: string | null
          adset_name?: string | null
          campaign_name: string
          clicks?: number | null
          client_id: string
          conversions?: number | null
          cpa?: number | null
          created_at?: string | null
          creative_thumbnail_url?: string | null
          creative_type?: string | null
          cta?: string | null
          ctr?: number | null
          date_from?: string | null
          date_to?: string | null
          description?: string | null
          descriptions?: string[] | null
          display_url?: string | null
          final_url?: string | null
          format?: string | null
          frequency?: number | null
          headline?: string | null
          headlines?: string[] | null
          id?: string
          impressions?: number | null
          link_url?: string | null
          platform: string
          platform_ad_id?: string | null
          platform_adset_id?: string | null
          platform_campaign_id?: string | null
          primary_text?: string | null
          revenue?: number | null
          roas?: number | null
          spend?: number | null
          status?: string | null
          updated_at?: string | null
          vertical?: string | null
          video_url?: string | null
          video_views_25?: number | null
          video_views_3s?: number | null
          video_views_50?: number | null
          video_views_95?: number | null
        }
        Update: {
          ad_name?: string | null
          adset_name?: string | null
          campaign_name?: string
          clicks?: number | null
          client_id?: string
          conversions?: number | null
          cpa?: number | null
          created_at?: string | null
          creative_thumbnail_url?: string | null
          creative_type?: string | null
          cta?: string | null
          ctr?: number | null
          date_from?: string | null
          date_to?: string | null
          description?: string | null
          descriptions?: string[] | null
          display_url?: string | null
          final_url?: string | null
          format?: string | null
          frequency?: number | null
          headline?: string | null
          headlines?: string[] | null
          id?: string
          impressions?: number | null
          link_url?: string | null
          platform?: string
          platform_ad_id?: string | null
          platform_adset_id?: string | null
          platform_campaign_id?: string | null
          primary_text?: string | null
          revenue?: number | null
          roas?: number | null
          spend?: number | null
          status?: string | null
          updated_at?: string | null
          vertical?: string | null
          video_url?: string | null
          video_views_25?: number | null
          video_views_3s?: number | null
          video_views_50?: number | null
          video_views_95?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_creatives_client_id_fkey"
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
      ad_sets: {
        Row: {
          account_id: string | null
          adset_name: string
          campaign_name: string
          clicks: number
          client_id: string
          conversions: number
          cpa: number | null
          cpc: number | null
          created_at: string
          ctr: number | null
          date: string
          id: string
          impressions: number
          platform: string
          platform_adset_id: string | null
          platform_campaign_id: string | null
          revenue: number
          spend: number
          status: string | null
        }
        Insert: {
          account_id?: string | null
          adset_name: string
          campaign_name: string
          clicks?: number
          client_id: string
          conversions?: number
          cpa?: number | null
          cpc?: number | null
          created_at?: string
          ctr?: number | null
          date: string
          id?: string
          impressions?: number
          platform: string
          platform_adset_id?: string | null
          platform_campaign_id?: string | null
          revenue?: number
          spend?: number
          status?: string | null
        }
        Update: {
          account_id?: string | null
          adset_name?: string
          campaign_name?: string
          clicks?: number
          client_id?: string
          conversions?: number
          cpa?: number | null
          cpc?: number | null
          created_at?: string
          ctr?: number | null
          date?: string
          id?: string
          impressions?: number
          platform?: string
          platform_adset_id?: string | null
          platform_campaign_id?: string | null
          revenue?: number
          spend?: number
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_sets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      agenda_templates: {
        Row: {
          client_id: string
          created_at: string
          created_by_id: string | null
          id: string
          is_default: boolean
          name: string
          sections: Json
          template_type: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by_id?: string | null
          id?: string
          is_default?: boolean
          name: string
          sections?: Json
          template_type?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by_id?: string | null
          id?: string
          is_default?: boolean
          name?: string
          sections?: Json
          template_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agenda_templates_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agenda_templates_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_copy_generations: {
        Row: {
          ads_analyzed: number | null
          campaign_context: Json | null
          client_id: string
          created_at: string
          created_by_id: string | null
          generated_options: Json | null
          id: string
          selected_option: Json | null
          trafficking_ad_id: string | null
        }
        Insert: {
          ads_analyzed?: number | null
          campaign_context?: Json | null
          client_id: string
          created_at?: string
          created_by_id?: string | null
          generated_options?: Json | null
          id?: string
          selected_option?: Json | null
          trafficking_ad_id?: string | null
        }
        Update: {
          ads_analyzed?: number | null
          campaign_context?: Json | null
          client_id?: string
          created_at?: string
          created_by_id?: string | null
          generated_options?: Json | null
          id?: string
          selected_option?: Json | null
          trafficking_ad_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_copy_generations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_copy_generations_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_copy_generations_trafficking_ad_id_fkey"
            columns: ["trafficking_ad_id"]
            isOneToOne: false
            referencedRelation: "trafficking_ads"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_optimization_recommendations: {
        Row: {
          client_id: string
          created_at: string
          current_metrics: Json | null
          description: string | null
          entity_id: string | null
          entity_name: string | null
          entity_type: string
          id: string
          platform: string
          projected_impact: Json | null
          recommendation_type: string
          recommended_action: Json | null
          resolved_at: string | null
          resolved_by_id: string | null
          severity: string
          status: string
          title: string
          updated_at: string
          vertical_id: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          current_metrics?: Json | null
          description?: string | null
          entity_id?: string | null
          entity_name?: string | null
          entity_type: string
          id?: string
          platform: string
          projected_impact?: Json | null
          recommendation_type: string
          recommended_action?: Json | null
          resolved_at?: string | null
          resolved_by_id?: string | null
          severity?: string
          status?: string
          title: string
          updated_at?: string
          vertical_id?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          current_metrics?: Json | null
          description?: string | null
          entity_id?: string | null
          entity_name?: string | null
          entity_type?: string
          id?: string
          platform?: string
          projected_impact?: Json | null
          recommendation_type?: string
          recommended_action?: Json | null
          resolved_at?: string | null
          resolved_by_id?: string | null
          severity?: string
          status?: string
          title?: string
          updated_at?: string
          vertical_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_optimization_recommendations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_optimization_recommendations_resolved_by_id_fkey"
            columns: ["resolved_by_id"]
            isOneToOne: false
            referencedRelation: "team_members"
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
          ai_context: Json | null
          call_date: string
          call_type: string
          client_id: string
          created_at: string
          created_by_id: string | null
          id: string
          notes_content: Json | null
          published_at: string | null
          source_agenda_id: string | null
          status: string
          template_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          agenda_content?: Json | null
          ai_context?: Json | null
          call_date: string
          call_type?: string
          client_id: string
          created_at?: string
          created_by_id?: string | null
          id?: string
          notes_content?: Json | null
          published_at?: string | null
          source_agenda_id?: string | null
          status?: string
          template_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          agenda_content?: Json | null
          ai_context?: Json | null
          call_date?: string
          call_type?: string
          client_id?: string
          created_at?: string
          created_by_id?: string | null
          id?: string
          notes_content?: Json | null
          published_at?: string | null
          source_agenda_id?: string | null
          status?: string
          template_id?: string | null
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
          {
            foreignKeyName: "call_agendas_source_agenda_id_fkey"
            columns: ["source_agenda_id"]
            isOneToOne: false
            referencedRelation: "call_agendas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_agendas_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "agenda_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_budget_phases: {
        Row: {
          actual_spend: number | null
          campaign_id: string
          created_at: string
          daily_budget: number | null
          end_date: string | null
          id: string
          percentage_of_total: number | null
          phase_name: string
          phase_total: number | null
          position: number | null
          start_date: string | null
        }
        Insert: {
          actual_spend?: number | null
          campaign_id: string
          created_at?: string
          daily_budget?: number | null
          end_date?: string | null
          id?: string
          percentage_of_total?: number | null
          phase_name: string
          phase_total?: number | null
          position?: number | null
          start_date?: string | null
        }
        Update: {
          actual_spend?: number | null
          campaign_id?: string
          created_at?: string
          daily_budget?: number | null
          end_date?: string | null
          id?: string
          percentage_of_total?: number | null
          phase_name?: string
          phase_total?: number | null
          position?: number | null
          start_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_budget_phases_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "trafficking_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_extensions: {
        Row: {
          campaign_id: string
          created_at: string
          description: string | null
          extension_type: string
          header: string | null
          id: string
          text: string
          url: string | null
          values_text: string | null
        }
        Insert: {
          campaign_id: string
          created_at?: string
          description?: string | null
          extension_type: string
          header?: string | null
          id?: string
          text: string
          url?: string | null
          values_text?: string | null
        }
        Update: {
          campaign_id?: string
          created_at?: string
          description?: string | null
          extension_type?: string
          header?: string | null
          id?: string
          text?: string
          url?: string | null
          values_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_extensions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "trafficking_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_keywords: {
        Row: {
          ad_group: string
          campaign_id: string
          clicks: number | null
          client_id: string | null
          conversions: number | null
          cpa: number | null
          cpc: number | null
          created_at: string
          ctr: number | null
          date: string | null
          id: string
          impression_share: number | null
          impressions: number | null
          intent: string | null
          is_negative: boolean | null
          keyword: string
          match_type: string | null
          negative_category: string | null
          platform_adset_id: string | null
          quality_score: number | null
          revenue: number | null
          spend: number | null
        }
        Insert: {
          ad_group: string
          campaign_id: string
          clicks?: number | null
          client_id?: string | null
          conversions?: number | null
          cpa?: number | null
          cpc?: number | null
          created_at?: string
          ctr?: number | null
          date?: string | null
          id?: string
          impression_share?: number | null
          impressions?: number | null
          intent?: string | null
          is_negative?: boolean | null
          keyword: string
          match_type?: string | null
          negative_category?: string | null
          platform_adset_id?: string | null
          quality_score?: number | null
          revenue?: number | null
          spend?: number | null
        }
        Update: {
          ad_group?: string
          campaign_id?: string
          clicks?: number | null
          client_id?: string | null
          conversions?: number | null
          cpa?: number | null
          cpc?: number | null
          created_at?: string
          ctr?: number | null
          date?: string | null
          id?: string
          impression_share?: number | null
          impressions?: number | null
          intent?: string | null
          is_negative?: boolean | null
          keyword?: string
          match_type?: string | null
          negative_category?: string | null
          platform_adset_id?: string | null
          quality_score?: number | null
          revenue?: number | null
          spend?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_keywords_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "trafficking_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_keywords_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
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
      client_drive_config: {
        Row: {
          client_id: string
          connected_at: string | null
          connected_by_id: string | null
          drive_root_folder_id: string
          drive_root_folder_url: string | null
          folder_structure: Json | null
          id: string
          updated_at: string
        }
        Insert: {
          client_id: string
          connected_at?: string | null
          connected_by_id?: string | null
          drive_root_folder_id: string
          drive_root_folder_url?: string | null
          folder_structure?: Json | null
          id?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          connected_at?: string | null
          connected_by_id?: string | null
          drive_root_folder_id?: string
          drive_root_folder_url?: string | null
          folder_structure?: Json | null
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_drive_config_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_drive_config_connected_by_id_fkey"
            columns: ["connected_by_id"]
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
      content_calendar_entries: {
        Row: {
          ad_formats_planned: string[] | null
          client_id: string
          created_at: string
          created_by_id: string | null
          creative_theme: string | null
          delivery_deadline: string | null
          id: string
          launch_target: string | null
          linked_brief_ids: string[] | null
          notes: string | null
          product_focus: string | null
          status: string
          updated_at: string
          week_of: string
        }
        Insert: {
          ad_formats_planned?: string[] | null
          client_id: string
          created_at?: string
          created_by_id?: string | null
          creative_theme?: string | null
          delivery_deadline?: string | null
          id?: string
          launch_target?: string | null
          linked_brief_ids?: string[] | null
          notes?: string | null
          product_focus?: string | null
          status?: string
          updated_at?: string
          week_of: string
        }
        Update: {
          ad_formats_planned?: string[] | null
          client_id?: string
          created_at?: string
          created_by_id?: string | null
          creative_theme?: string | null
          delivery_deadline?: string | null
          id?: string
          launch_target?: string | null
          linked_brief_ids?: string[] | null
          notes?: string | null
          product_focus?: string | null
          status?: string
          updated_at?: string
          week_of?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_calendar_entries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_calendar_entries_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
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
      creative_brief_comments: {
        Row: {
          author_id: string
          brief_id: string
          content: string
          created_at: string
          id: string
        }
        Insert: {
          author_id: string
          brief_id: string
          content: string
          created_at?: string
          id?: string
        }
        Update: {
          author_id?: string
          brief_id?: string
          content?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_brief_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_brief_comments_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "creative_briefs"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_brief_templates: {
        Row: {
          created_at: string
          created_by_id: string | null
          id: string
          is_global: boolean
          name: string
          template_data: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_id?: string | null
          id?: string
          is_global?: boolean
          name: string
          template_data?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_id?: string | null
          id?: string
          is_global?: boolean
          name?: string
          template_data?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_brief_templates_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_briefs: {
        Row: {
          approved_at: string | null
          assigned_to_id: string | null
          brand_guidelines_url: string | null
          client_id: string | null
          copy_suggestions: Json | null
          created_at: string
          created_by_id: string | null
          creative_type: string
          creative_types: string[] | null
          delivered_at: string | null
          dos_and_donts: string | null
          drive_approved_folder_id: string | null
          drive_wip_folder_id: string | null
          due_date: string | null
          estimated_hours: number | null
          funnel_stage: string | null
          id: string
          key_message: string | null
          notes: string | null
          num_concepts: number | null
          objective: string | null
          platforms: string[] | null
          priority: string
          reference_assets: Json | null
          scheduled_date: string | null
          sizes: Json | null
          status: string
          submitted_at: string | null
          target_audience: string | null
          template_id: string | null
          title: string
          tone_style: string | null
          trafficked_at: string | null
          trafficked_by_id: string | null
          updated_at: string
          video_scripts: Json | null
        }
        Insert: {
          approved_at?: string | null
          assigned_to_id?: string | null
          brand_guidelines_url?: string | null
          client_id?: string | null
          copy_suggestions?: Json | null
          created_at?: string
          created_by_id?: string | null
          creative_type?: string
          creative_types?: string[] | null
          delivered_at?: string | null
          dos_and_donts?: string | null
          drive_approved_folder_id?: string | null
          drive_wip_folder_id?: string | null
          due_date?: string | null
          estimated_hours?: number | null
          funnel_stage?: string | null
          id?: string
          key_message?: string | null
          notes?: string | null
          num_concepts?: number | null
          objective?: string | null
          platforms?: string[] | null
          priority?: string
          reference_assets?: Json | null
          scheduled_date?: string | null
          sizes?: Json | null
          status?: string
          submitted_at?: string | null
          target_audience?: string | null
          template_id?: string | null
          title: string
          tone_style?: string | null
          trafficked_at?: string | null
          trafficked_by_id?: string | null
          updated_at?: string
          video_scripts?: Json | null
        }
        Update: {
          approved_at?: string | null
          assigned_to_id?: string | null
          brand_guidelines_url?: string | null
          client_id?: string | null
          copy_suggestions?: Json | null
          created_at?: string
          created_by_id?: string | null
          creative_type?: string
          creative_types?: string[] | null
          delivered_at?: string | null
          dos_and_donts?: string | null
          drive_approved_folder_id?: string | null
          drive_wip_folder_id?: string | null
          due_date?: string | null
          estimated_hours?: number | null
          funnel_stage?: string | null
          id?: string
          key_message?: string | null
          notes?: string | null
          num_concepts?: number | null
          objective?: string | null
          platforms?: string[] | null
          priority?: string
          reference_assets?: Json | null
          scheduled_date?: string | null
          sizes?: Json | null
          status?: string
          submitted_at?: string | null
          target_audience?: string | null
          template_id?: string | null
          title?: string
          tone_style?: string | null
          trafficked_at?: string | null
          trafficked_by_id?: string | null
          updated_at?: string
          video_scripts?: Json | null
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
      creative_deliverable_versions: {
        Row: {
          deliverable_id: string
          drive_file_id: string | null
          drive_url: string | null
          file_name: string | null
          file_size_bytes: number | null
          file_type: string | null
          file_url: string | null
          id: string
          uploaded_at: string | null
          uploaded_by_id: string | null
          version: number
        }
        Insert: {
          deliverable_id: string
          drive_file_id?: string | null
          drive_url?: string | null
          file_name?: string | null
          file_size_bytes?: number | null
          file_type?: string | null
          file_url?: string | null
          id?: string
          uploaded_at?: string | null
          uploaded_by_id?: string | null
          version: number
        }
        Update: {
          deliverable_id?: string
          drive_file_id?: string | null
          drive_url?: string | null
          file_name?: string | null
          file_size_bytes?: number | null
          file_type?: string | null
          file_url?: string | null
          id?: string
          uploaded_at?: string | null
          uploaded_by_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "creative_deliverable_versions_deliverable_id_fkey"
            columns: ["deliverable_id"]
            isOneToOne: false
            referencedRelation: "creative_deliverables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_deliverable_versions_uploaded_by_id_fkey"
            columns: ["uploaded_by_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_deliverables: {
        Row: {
          approved_at: string | null
          approved_by_id: string | null
          brief_id: string
          concept_label: string | null
          drive_url: string | null
          file_name: string
          file_size: number | null
          file_size_bytes: number | null
          file_type: string | null
          file_url: string
          height: number | null
          id: string
          revision_note: string | null
          size_label: string | null
          status: string
          thumbnail_url: string | null
          uploaded_at: string
          uploaded_by_id: string | null
          version: number
          width: number | null
        }
        Insert: {
          approved_at?: string | null
          approved_by_id?: string | null
          brief_id: string
          concept_label?: string | null
          drive_url?: string | null
          file_name: string
          file_size?: number | null
          file_size_bytes?: number | null
          file_type?: string | null
          file_url: string
          height?: number | null
          id?: string
          revision_note?: string | null
          size_label?: string | null
          status?: string
          thumbnail_url?: string | null
          uploaded_at?: string
          uploaded_by_id?: string | null
          version?: number
          width?: number | null
        }
        Update: {
          approved_at?: string | null
          approved_by_id?: string | null
          brief_id?: string
          concept_label?: string | null
          drive_url?: string | null
          file_name?: string
          file_size?: number | null
          file_size_bytes?: number | null
          file_type?: string | null
          file_url?: string
          height?: number | null
          id?: string
          revision_note?: string | null
          size_label?: string | null
          status?: string
          thumbnail_url?: string | null
          uploaded_at?: string
          uploaded_by_id?: string | null
          version?: number
          width?: number | null
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
          deliverable_id: string | null
          id: string
          reviewer_id: string
        }
        Insert: {
          action: string
          brief_id: string
          comments?: string | null
          created_at?: string
          deliverable_id?: string | null
          id?: string
          reviewer_id: string
        }
        Update: {
          action?: string
          brief_id?: string
          comments?: string | null
          created_at?: string
          deliverable_id?: string | null
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
      creative_time_entries: {
        Row: {
          brief_id: string
          client_id: string
          created_at: string
          description: string | null
          duration_minutes: number | null
          ended_at: string | null
          id: string
          is_manual: boolean
          started_at: string
          team_member_id: string
          updated_at: string
        }
        Insert: {
          brief_id: string
          client_id: string
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          ended_at?: string | null
          id?: string
          is_manual?: boolean
          started_at?: string
          team_member_id: string
          updated_at?: string
        }
        Update: {
          brief_id?: string
          client_id?: string
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          ended_at?: string | null
          id?: string
          is_manual?: boolean
          started_at?: string
          team_member_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_time_entries_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "creative_briefs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_time_entries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_time_entries_team_member_id_fkey"
            columns: ["team_member_id"]
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
      designer_monthly_caps: {
        Row: {
          cap_hours: number
          created_at: string
          id: string
          month: string
          team_member_id: string
        }
        Insert: {
          cap_hours?: number
          created_at?: string
          id?: string
          month: string
          team_member_id: string
        }
        Update: {
          cap_hours?: number
          created_at?: string
          id?: string
          month?: string
          team_member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "designer_monthly_caps_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
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
      notifications: {
        Row: {
          brief_id: string | null
          created_at: string
          id: string
          is_read: boolean
          message: string | null
          recipient_id: string
          title: string
          type: string
        }
        Insert: {
          brief_id?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string | null
          recipient_id: string
          title: string
          type: string
        }
        Update: {
          brief_id?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string | null
          recipient_id?: string
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "creative_briefs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
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
      ringba_calls: {
        Row: {
          call_date: string
          call_id: string
          caller_number: string | null
          campaign_name: string | null
          client_id: string
          connected: boolean | null
          converted: boolean | null
          created_at: string
          duration_seconds: number | null
          id: string
          inbound_number: string | null
          metadata: Json | null
          payout: number
          revenue: number
          target_name: string | null
        }
        Insert: {
          call_date: string
          call_id: string
          caller_number?: string | null
          campaign_name?: string | null
          client_id: string
          connected?: boolean | null
          converted?: boolean | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          inbound_number?: string | null
          metadata?: Json | null
          payout?: number
          revenue?: number
          target_name?: string | null
        }
        Update: {
          call_date?: string
          call_id?: string
          caller_number?: string | null
          campaign_name?: string | null
          client_id?: string
          connected?: boolean | null
          converted?: boolean | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          inbound_number?: string | null
          metadata?: Json | null
          payout?: number
          revenue?: number
          target_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ringba_calls_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      search_terms: {
        Row: {
          campaign_name: string | null
          clicks: number
          client_id: string
          conversions: number
          cpa: number | null
          cpc: number | null
          created_at: string
          ctr: number | null
          date: string
          id: string
          impressions: number
          keyword_text: string | null
          match_type: string | null
          platform_adset_id: string
          platform_campaign_id: string | null
          revenue: number
          search_term: string
          spend: number
        }
        Insert: {
          campaign_name?: string | null
          clicks?: number
          client_id: string
          conversions?: number
          cpa?: number | null
          cpc?: number | null
          created_at?: string
          ctr?: number | null
          date: string
          id?: string
          impressions?: number
          keyword_text?: string | null
          match_type?: string | null
          platform_adset_id: string
          platform_campaign_id?: string | null
          revenue?: number
          search_term: string
          spend?: number
        }
        Update: {
          campaign_name?: string | null
          clicks?: number
          client_id?: string
          conversions?: number
          cpa?: number | null
          cpc?: number | null
          created_at?: string
          ctr?: number | null
          date?: string
          id?: string
          impressions?: number
          keyword_text?: string | null
          match_type?: string | null
          platform_adset_id?: string
          platform_campaign_id?: string | null
          revenue?: number
          search_term?: string
          spend?: number
        }
        Relationships: [
          {
            foreignKeyName: "search_terms_client_id_fkey"
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
      trafficking_ad_performance: {
        Row: {
          clicks: number | null
          conversions: number | null
          cpa: number | null
          created_at: string
          ctr: number | null
          date: string
          id: string
          impressions: number | null
          revenue: number | null
          roas: number | null
          spend: number | null
          trafficking_ad_id: string
        }
        Insert: {
          clicks?: number | null
          conversions?: number | null
          cpa?: number | null
          created_at?: string
          ctr?: number | null
          date: string
          id?: string
          impressions?: number | null
          revenue?: number | null
          roas?: number | null
          spend?: number | null
          trafficking_ad_id: string
        }
        Update: {
          clicks?: number | null
          conversions?: number | null
          cpa?: number | null
          created_at?: string
          ctr?: number | null
          date?: string
          id?: string
          impressions?: number | null
          revenue?: number | null
          roas?: number | null
          spend?: number | null
          trafficking_ad_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trafficking_ad_performance_trafficking_ad_id_fkey"
            columns: ["trafficking_ad_id"]
            isOneToOne: false
            referencedRelation: "trafficking_ads"
            referencedColumns: ["id"]
          },
        ]
      }
      trafficking_ads: {
        Row: {
          ad_group: string | null
          ad_name: string
          approved_at: string | null
          approved_by_id: string | null
          asset_urls: Json | null
          brief_id: string | null
          campaign_id: string | null
          client_id: string
          created_at: string
          created_by_id: string | null
          creative_deadline: string | null
          cta: string | null
          deliverable_ids: string[] | null
          description: string | null
          description_2: string | null
          final_url: string | null
          format: string | null
          headline: string | null
          headline_2: string | null
          headline_3: string | null
          id: string
          launch_checklist: Json | null
          launch_target: string | null
          launched_at: string | null
          notes: string | null
          platform: string | null
          platform_ad_id: string | null
          platform_adset_id: string | null
          platform_campaign_id: string | null
          preview_html: string | null
          preview_screenshots: Json | null
          preview_url: string | null
          primary_text: string | null
          status: string
          trafficked_at: string | null
          trafficked_by_id: string | null
          updated_at: string
          utm_parameters: string | null
        }
        Insert: {
          ad_group?: string | null
          ad_name: string
          approved_at?: string | null
          approved_by_id?: string | null
          asset_urls?: Json | null
          brief_id?: string | null
          campaign_id?: string | null
          client_id: string
          created_at?: string
          created_by_id?: string | null
          creative_deadline?: string | null
          cta?: string | null
          deliverable_ids?: string[] | null
          description?: string | null
          description_2?: string | null
          final_url?: string | null
          format?: string | null
          headline?: string | null
          headline_2?: string | null
          headline_3?: string | null
          id?: string
          launch_checklist?: Json | null
          launch_target?: string | null
          launched_at?: string | null
          notes?: string | null
          platform?: string | null
          platform_ad_id?: string | null
          platform_adset_id?: string | null
          platform_campaign_id?: string | null
          preview_html?: string | null
          preview_screenshots?: Json | null
          preview_url?: string | null
          primary_text?: string | null
          status?: string
          trafficked_at?: string | null
          trafficked_by_id?: string | null
          updated_at?: string
          utm_parameters?: string | null
        }
        Update: {
          ad_group?: string | null
          ad_name?: string
          approved_at?: string | null
          approved_by_id?: string | null
          asset_urls?: Json | null
          brief_id?: string | null
          campaign_id?: string | null
          client_id?: string
          created_at?: string
          created_by_id?: string | null
          creative_deadline?: string | null
          cta?: string | null
          deliverable_ids?: string[] | null
          description?: string | null
          description_2?: string | null
          final_url?: string | null
          format?: string | null
          headline?: string | null
          headline_2?: string | null
          headline_3?: string | null
          id?: string
          launch_checklist?: Json | null
          launch_target?: string | null
          launched_at?: string | null
          notes?: string | null
          platform?: string | null
          platform_ad_id?: string | null
          platform_adset_id?: string | null
          platform_campaign_id?: string | null
          preview_html?: string | null
          preview_screenshots?: Json | null
          preview_url?: string | null
          primary_text?: string | null
          status?: string
          trafficked_at?: string | null
          trafficked_by_id?: string | null
          updated_at?: string
          utm_parameters?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trafficking_ads_approved_by_id_fkey"
            columns: ["approved_by_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trafficking_ads_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "creative_briefs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trafficking_ads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "trafficking_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trafficking_ads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trafficking_ads_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trafficking_ads_trafficked_by_id_fkey"
            columns: ["trafficked_by_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      trafficking_campaigns: {
        Row: {
          bidding_strategy: string | null
          client_id: string
          created_at: string
          created_by_id: string | null
          end_date: string | null
          id: string
          location: string | null
          name: string
          objective: string | null
          platform: string
          start_date: string | null
          status: string
          total_budget: number | null
          updated_at: string
        }
        Insert: {
          bidding_strategy?: string | null
          client_id: string
          created_at?: string
          created_by_id?: string | null
          end_date?: string | null
          id?: string
          location?: string | null
          name: string
          objective?: string | null
          platform: string
          start_date?: string | null
          status?: string
          total_budget?: number | null
          updated_at?: string
        }
        Update: {
          bidding_strategy?: string | null
          client_id?: string
          created_at?: string
          created_by_id?: string | null
          end_date?: string | null
          id?: string
          location?: string | null
          name?: string
          objective?: string | null
          platform?: string
          start_date?: string | null
          status?: string
          total_budget?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trafficking_campaigns_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trafficking_campaigns_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
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
