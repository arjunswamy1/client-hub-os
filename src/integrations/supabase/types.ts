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
          bid_strategy: string | null
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
          lifetime_budget: number | null
          objective: string | null
          platform: string
          revenue: number
          roas: number | null
          spend: number
          status: string | null
        }
        Insert: {
          account_id?: string | null
          add_to_cart?: number | null
          bid_strategy?: string | null
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
          lifetime_budget?: number | null
          objective?: string | null
          platform: string
          revenue?: number
          roas?: number | null
          spend?: number
          status?: string | null
        }
        Update: {
          account_id?: string | null
          add_to_cart?: number | null
          bid_strategy?: string | null
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
          lifetime_budget?: number | null
          objective?: string | null
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
          audience_summary: string | null
          bid_amount: number | null
          bid_strategy: string | null
          billing_event: string | null
          campaign_name: string
          clicks: number
          client_id: string
          conversions: number
          cpa: number | null
          cpc: number | null
          created_at: string
          ctr: number | null
          daily_budget: number | null
          date: string
          frequency: number | null
          id: string
          impressions: number
          lifetime_budget: number | null
          optimization_goal: string | null
          platform: string
          platform_adset_id: string | null
          platform_campaign_id: string | null
          promoted_object: Json | null
          reach: number | null
          revenue: number
          spend: number
          status: string | null
          targeting: Json | null
        }
        Insert: {
          account_id?: string | null
          adset_name: string
          audience_summary?: string | null
          bid_amount?: number | null
          bid_strategy?: string | null
          billing_event?: string | null
          campaign_name: string
          clicks?: number
          client_id: string
          conversions?: number
          cpa?: number | null
          cpc?: number | null
          created_at?: string
          ctr?: number | null
          daily_budget?: number | null
          date: string
          frequency?: number | null
          id?: string
          impressions?: number
          lifetime_budget?: number | null
          optimization_goal?: string | null
          platform: string
          platform_adset_id?: string | null
          platform_campaign_id?: string | null
          promoted_object?: Json | null
          reach?: number | null
          revenue?: number
          spend?: number
          status?: string | null
          targeting?: Json | null
        }
        Update: {
          account_id?: string | null
          adset_name?: string
          audience_summary?: string | null
          bid_amount?: number | null
          bid_strategy?: string | null
          billing_event?: string | null
          campaign_name?: string
          clicks?: number
          client_id?: string
          conversions?: number
          cpa?: number | null
          cpc?: number | null
          created_at?: string
          ctr?: number | null
          daily_budget?: number | null
          date?: string
          frequency?: number | null
          id?: string
          impressions?: number
          lifetime_budget?: number | null
          optimization_goal?: string | null
          platform?: string
          platform_adset_id?: string | null
          platform_campaign_id?: string | null
          promoted_object?: Json | null
          reach?: number | null
          revenue?: number
          spend?: number
          status?: string | null
          targeting?: Json | null
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
      ai_optimizer_briefs: {
        Row: {
          attribution_rate: number | null
          client_id: string
          created_at: string
          generated_at: string
          id: string
          line_label: string | null
          period_key: string
          plan: Json
          product_line: string
          range_label: string | null
          scope: string
          source: string
          totals: Json
        }
        Insert: {
          attribution_rate?: number | null
          client_id: string
          created_at?: string
          generated_at?: string
          id?: string
          line_label?: string | null
          period_key: string
          plan: Json
          product_line: string
          range_label?: string | null
          scope?: string
          source?: string
          totals?: Json
        }
        Update: {
          attribution_rate?: number | null
          client_id?: string
          created_at?: string
          generated_at?: string
          id?: string
          line_label?: string | null
          period_key?: string
          plan?: Json
          product_line?: string
          range_label?: string | null
          scope?: string
          source?: string
          totals?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ai_optimizer_briefs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_optimizer_schedules: {
        Row: {
          cadence: string
          client_id: string
          created_at: string
          enabled: boolean
          id: string
          last_error: string | null
          last_run_at: string | null
          lease_until: string | null
          next_run_at: string | null
          notes: string | null
          pause_reason: string | null
          paused_at: string | null
          product_lines: string[]
          run_hour_utc: number
          scope: string
          status: string
          updated_at: string
        }
        Insert: {
          cadence?: string
          client_id: string
          created_at?: string
          enabled?: boolean
          id?: string
          last_error?: string | null
          last_run_at?: string | null
          lease_until?: string | null
          next_run_at?: string | null
          notes?: string | null
          pause_reason?: string | null
          paused_at?: string | null
          product_lines?: string[]
          run_hour_utc?: number
          scope?: string
          status?: string
          updated_at?: string
        }
        Update: {
          cadence?: string
          client_id?: string
          created_at?: string
          enabled?: boolean
          id?: string
          last_error?: string | null
          last_run_at?: string | null
          lease_until?: string | null
          next_run_at?: string | null
          notes?: string | null
          pause_reason?: string | null
          paused_at?: string | null
          product_lines?: string[]
          run_hour_utc?: number
          scope?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_optimizer_schedules_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_video_audio: {
        Row: {
          audio_type: string
          audio_url: string | null
          created_at: string
          duration_ms: number | null
          elevenlabs_model: string | null
          elevenlabs_voice_id: string | null
          feedback: string | null
          id: string
          project_id: string
          prompt: string | null
          script_text: string | null
          settings: Json | null
          version: number
        }
        Insert: {
          audio_type: string
          audio_url?: string | null
          created_at?: string
          duration_ms?: number | null
          elevenlabs_model?: string | null
          elevenlabs_voice_id?: string | null
          feedback?: string | null
          id?: string
          project_id: string
          prompt?: string | null
          script_text?: string | null
          settings?: Json | null
          version?: number
        }
        Update: {
          audio_type?: string
          audio_url?: string | null
          created_at?: string
          duration_ms?: number | null
          elevenlabs_model?: string | null
          elevenlabs_voice_id?: string | null
          feedback?: string | null
          id?: string
          project_id?: string
          prompt?: string | null
          script_text?: string | null
          settings?: Json | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_video_audio_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "ai_video_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_video_brand_kits: {
        Row: {
          client_id: string
          colors: Json | null
          created_at: string
          default_voice_id: string | null
          default_voice_name: string | null
          fonts: Json | null
          id: string
          intro_template: Json | null
          logo_animation_url: string | null
          logo_url: string | null
          outro_template: Json | null
          style_keywords: string[] | null
          updated_at: string
        }
        Insert: {
          client_id: string
          colors?: Json | null
          created_at?: string
          default_voice_id?: string | null
          default_voice_name?: string | null
          fonts?: Json | null
          id?: string
          intro_template?: Json | null
          logo_animation_url?: string | null
          logo_url?: string | null
          outro_template?: Json | null
          style_keywords?: string[] | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          colors?: Json | null
          created_at?: string
          default_voice_id?: string | null
          default_voice_name?: string | null
          fonts?: Json | null
          id?: string
          intro_template?: Json | null
          logo_animation_url?: string | null
          logo_url?: string | null
          outro_template?: Json | null
          style_keywords?: string[] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_video_brand_kits_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_video_clips: {
        Row: {
          actual_duration_seconds: number | null
          clip_number: number
          created_at: string
          error_code: string | null
          error_message: string | null
          failed_at: string | null
          feedback: string | null
          feedback_applied: boolean
          generated_options: Json | null
          id: string
          is_override: boolean
          override_source: string | null
          override_video_url: string | null
          progress_message: string | null
          progress_pct: number | null
          progress_updated_at: string | null
          project_id: string
          reference_image_urls: string[] | null
          selected_option_index: number | null
          started_at: string | null
          status: string
          text_overlay: Json | null
          transition_overlap_seconds: number
          transition_type: string
          veo_aspect_ratio: string | null
          veo_model: string | null
          veo_negative_prompt: string | null
          veo_prompt: string
          veo_resolution: string | null
          version: number
          vo_end_ms: number | null
          vo_start_ms: number | null
          vo_text: string | null
        }
        Insert: {
          actual_duration_seconds?: number | null
          clip_number: number
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          failed_at?: string | null
          feedback?: string | null
          feedback_applied?: boolean
          generated_options?: Json | null
          id?: string
          is_override?: boolean
          override_source?: string | null
          override_video_url?: string | null
          progress_message?: string | null
          progress_pct?: number | null
          progress_updated_at?: string | null
          project_id: string
          reference_image_urls?: string[] | null
          selected_option_index?: number | null
          started_at?: string | null
          status?: string
          text_overlay?: Json | null
          transition_overlap_seconds?: number
          transition_type?: string
          veo_aspect_ratio?: string | null
          veo_model?: string | null
          veo_negative_prompt?: string | null
          veo_prompt: string
          veo_resolution?: string | null
          version?: number
          vo_end_ms?: number | null
          vo_start_ms?: number | null
          vo_text?: string | null
        }
        Update: {
          actual_duration_seconds?: number | null
          clip_number?: number
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          failed_at?: string | null
          feedback?: string | null
          feedback_applied?: boolean
          generated_options?: Json | null
          id?: string
          is_override?: boolean
          override_source?: string | null
          override_video_url?: string | null
          progress_message?: string | null
          progress_pct?: number | null
          progress_updated_at?: string | null
          project_id?: string
          reference_image_urls?: string[] | null
          selected_option_index?: number | null
          started_at?: string | null
          status?: string
          text_overlay?: Json | null
          transition_overlap_seconds?: number
          transition_type?: string
          veo_aspect_ratio?: string | null
          veo_model?: string | null
          veo_negative_prompt?: string | null
          veo_prompt?: string
          veo_resolution?: string | null
          version?: number
          vo_end_ms?: number | null
          vo_start_ms?: number | null
          vo_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_video_clips_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "ai_video_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_video_feedback_log: {
        Row: {
          action_taken: string | null
          classification: Json | null
          cost_actual: number | null
          created_at: string
          created_by_id: string | null
          feedback_text: string
          id: string
          project_id: string
          render_id: string | null
        }
        Insert: {
          action_taken?: string | null
          classification?: Json | null
          cost_actual?: number | null
          created_at?: string
          created_by_id?: string | null
          feedback_text: string
          id?: string
          project_id: string
          render_id?: string | null
        }
        Update: {
          action_taken?: string | null
          classification?: Json | null
          cost_actual?: number | null
          created_at?: string
          created_by_id?: string | null
          feedback_text?: string
          id?: string
          project_id?: string
          render_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_video_feedback_log_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "ai_video_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_video_feedback_log_render_id_fkey"
            columns: ["render_id"]
            isOneToOne: false
            referencedRelation: "ai_video_renders"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_video_projects: {
        Row: {
          ad_framework: string | null
          additional_direction: string | null
          aspect_ratio: string | null
          brand_kit: Json | null
          caption_settings: Json
          caption_style: string | null
          characters: Json | null
          client_id: string
          created_at: string
          created_by_id: string | null
          cta: string | null
          cta_overlay: string | null
          current_version: number
          disclaimer_overlay: string | null
          end_card_text: string | null
          freeform_brief: string | null
          hook_variants: Json | null
          id: string
          key_message: string | null
          landing_page_analysis: Json | null
          landing_page_url: string | null
          music_prompt: string | null
          music_settings: Json | null
          music_volume: number | null
          objective: string | null
          overlay_plan: Json | null
          phone_overlay: string | null
          reference_image_urls: string[] | null
          reference_video_urls: string[] | null
          selected_hook_index: number | null
          shot_list: Json | null
          status: string
          target_audience: string | null
          target_length_seconds: number | null
          target_platforms: string[] | null
          title: string
          tone_mood: string[] | null
          updated_at: string
          vertical: string | null
          visual_style: string[] | null
          vo_script: string | null
          vo_settings: Json | null
          vo_voice_id: string | null
        }
        Insert: {
          ad_framework?: string | null
          additional_direction?: string | null
          aspect_ratio?: string | null
          brand_kit?: Json | null
          caption_settings?: Json
          caption_style?: string | null
          characters?: Json | null
          client_id: string
          created_at?: string
          created_by_id?: string | null
          cta?: string | null
          cta_overlay?: string | null
          current_version?: number
          disclaimer_overlay?: string | null
          end_card_text?: string | null
          freeform_brief?: string | null
          hook_variants?: Json | null
          id?: string
          key_message?: string | null
          landing_page_analysis?: Json | null
          landing_page_url?: string | null
          music_prompt?: string | null
          music_settings?: Json | null
          music_volume?: number | null
          objective?: string | null
          overlay_plan?: Json | null
          phone_overlay?: string | null
          reference_image_urls?: string[] | null
          reference_video_urls?: string[] | null
          selected_hook_index?: number | null
          shot_list?: Json | null
          status?: string
          target_audience?: string | null
          target_length_seconds?: number | null
          target_platforms?: string[] | null
          title: string
          tone_mood?: string[] | null
          updated_at?: string
          vertical?: string | null
          visual_style?: string[] | null
          vo_script?: string | null
          vo_settings?: Json | null
          vo_voice_id?: string | null
        }
        Update: {
          ad_framework?: string | null
          additional_direction?: string | null
          aspect_ratio?: string | null
          brand_kit?: Json | null
          caption_settings?: Json
          caption_style?: string | null
          characters?: Json | null
          client_id?: string
          created_at?: string
          created_by_id?: string | null
          cta?: string | null
          cta_overlay?: string | null
          current_version?: number
          disclaimer_overlay?: string | null
          end_card_text?: string | null
          freeform_brief?: string | null
          hook_variants?: Json | null
          id?: string
          key_message?: string | null
          landing_page_analysis?: Json | null
          landing_page_url?: string | null
          music_prompt?: string | null
          music_settings?: Json | null
          music_volume?: number | null
          objective?: string | null
          overlay_plan?: Json | null
          phone_overlay?: string | null
          reference_image_urls?: string[] | null
          reference_video_urls?: string[] | null
          selected_hook_index?: number | null
          shot_list?: Json | null
          status?: string
          target_audience?: string | null
          target_length_seconds?: number | null
          target_platforms?: string[] | null
          title?: string
          tone_mood?: string[] | null
          updated_at?: string
          vertical?: string | null
          visual_style?: string[] | null
          vo_script?: string | null
          vo_settings?: Json | null
          vo_voice_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_video_projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_video_projects_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_video_renders: {
        Row: {
          caption_realign_count: number
          caption_validation: Json | null
          changes_applied: Json | null
          completed_at: string | null
          cost_estimate: number | null
          created_at: string
          duration_seconds: number | null
          edit_json: Json | null
          error_message: string | null
          feedback_category: string | null
          feedback_text: string | null
          id: string
          is_quick_fix: boolean
          output_url: string | null
          parent_render_id: string | null
          poster_url: string | null
          project_id: string
          requested_by_id: string | null
          shotstack_env: string
          shotstack_id: string | null
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          caption_realign_count?: number
          caption_validation?: Json | null
          changes_applied?: Json | null
          completed_at?: string | null
          cost_estimate?: number | null
          created_at?: string
          duration_seconds?: number | null
          edit_json?: Json | null
          error_message?: string | null
          feedback_category?: string | null
          feedback_text?: string | null
          id?: string
          is_quick_fix?: boolean
          output_url?: string | null
          parent_render_id?: string | null
          poster_url?: string | null
          project_id: string
          requested_by_id?: string | null
          shotstack_env?: string
          shotstack_id?: string | null
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          caption_realign_count?: number
          caption_validation?: Json | null
          changes_applied?: Json | null
          completed_at?: string | null
          cost_estimate?: number | null
          created_at?: string
          duration_seconds?: number | null
          edit_json?: Json | null
          error_message?: string | null
          feedback_category?: string | null
          feedback_text?: string | null
          id?: string
          is_quick_fix?: boolean
          output_url?: string | null
          parent_render_id?: string | null
          poster_url?: string | null
          project_id?: string
          requested_by_id?: string | null
          shotstack_env?: string
          shotstack_id?: string | null
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_video_renders_parent_render_id_fkey"
            columns: ["parent_render_id"]
            isOneToOne: false
            referencedRelation: "ai_video_renders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_video_renders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "ai_video_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_video_versions: {
        Row: {
          clip_selections: Json | null
          composition_settings: Json | null
          created_at: string
          exports: Json | null
          feedback: string | null
          id: string
          music_audio_url: string | null
          preview_video_url: string | null
          project_id: string
          version_number: number
          vo_audio_url: string | null
        }
        Insert: {
          clip_selections?: Json | null
          composition_settings?: Json | null
          created_at?: string
          exports?: Json | null
          feedback?: string | null
          id?: string
          music_audio_url?: string | null
          preview_video_url?: string | null
          project_id: string
          version_number: number
          vo_audio_url?: string | null
        }
        Update: {
          clip_selections?: Json | null
          composition_settings?: Json | null
          created_at?: string
          exports?: Json | null
          feedback?: string | null
          id?: string
          music_audio_url?: string | null
          preview_video_url?: string | null
          project_id?: string
          version_number?: number
          vo_audio_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_video_versions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "ai_video_projects"
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
      campaign_build_templates: {
        Row: {
          created_at: string
          created_by_id: string | null
          default_extensions: Json | null
          default_negatives: string[] | null
          id: string
          is_global: boolean | null
          name: string
          template_structure: Json | null
          vertical: string | null
        }
        Insert: {
          created_at?: string
          created_by_id?: string | null
          default_extensions?: Json | null
          default_negatives?: string[] | null
          id?: string
          is_global?: boolean | null
          name: string
          template_structure?: Json | null
          vertical?: string | null
        }
        Update: {
          created_at?: string
          created_by_id?: string | null
          default_extensions?: Json | null
          default_negatives?: string[] | null
          id?: string
          is_global?: boolean | null
          name?: string
          template_structure?: Json | null
          vertical?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_build_templates_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_builds: {
        Row: {
          additional_context: string | null
          audience_description: string | null
          budget_monthly: number | null
          campaign_structure: Json | null
          campaign_types: string[] | null
          client_id: string
          conversation_history: Json | null
          created_at: string
          created_by_id: string | null
          generated_files: Json | null
          goal: string | null
          id: string
          landing_page_analysis: Json | null
          landing_page_url: string | null
          location: string | null
          optimization_notes: string | null
          platform: string
          schedule: string | null
          status: string
          title: string | null
          updated_at: string
          vertical: string | null
        }
        Insert: {
          additional_context?: string | null
          audience_description?: string | null
          budget_monthly?: number | null
          campaign_structure?: Json | null
          campaign_types?: string[] | null
          client_id: string
          conversation_history?: Json | null
          created_at?: string
          created_by_id?: string | null
          generated_files?: Json | null
          goal?: string | null
          id?: string
          landing_page_analysis?: Json | null
          landing_page_url?: string | null
          location?: string | null
          optimization_notes?: string | null
          platform?: string
          schedule?: string | null
          status?: string
          title?: string | null
          updated_at?: string
          vertical?: string | null
        }
        Update: {
          additional_context?: string | null
          audience_description?: string | null
          budget_monthly?: number | null
          campaign_structure?: Json | null
          campaign_types?: string[] | null
          client_id?: string
          conversation_history?: Json | null
          created_at?: string
          created_by_id?: string | null
          generated_files?: Json | null
          goal?: string | null
          id?: string
          landing_page_analysis?: Json | null
          landing_page_url?: string | null
          location?: string | null
          optimization_notes?: string | null
          platform?: string
          schedule?: string | null
          status?: string
          title?: string | null
          updated_at?: string
          vertical?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_builds_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_builds_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "team_members"
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
          campaign_id: string | null
          campaign_name: string | null
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
          platform: string | null
          platform_adset_id: string | null
          quality_score: number | null
          revenue: number | null
          spend: number | null
        }
        Insert: {
          ad_group: string
          campaign_id?: string | null
          campaign_name?: string | null
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
          platform?: string | null
          platform_adset_id?: string | null
          quality_score?: number | null
          revenue?: number | null
          spend?: number | null
        }
        Update: {
          ad_group?: string
          campaign_id?: string | null
          campaign_name?: string | null
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
          platform?: string | null
          platform_adset_id?: string | null
          quality_score?: number | null
          revenue?: number | null
          spend?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_keywords_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      cannaball_calls: {
        Row: {
          call_id: string
          call_start: string
          caller_area_code: string | null
          caller_city: string | null
          caller_number: string | null
          caller_state: string | null
          caller_zip: string | null
          campaign_name: string | null
          client_id: string
          connected: boolean | null
          connection_duration_seconds: number | null
          created_at: string
          creative_name: string | null
          did: string | null
          disposition: string | null
          duration_seconds: number | null
          id: string
          payout: number | null
          platform: string | null
          raw_payload: Json | null
          recording_url: string | null
        }
        Insert: {
          call_id: string
          call_start: string
          caller_area_code?: string | null
          caller_city?: string | null
          caller_number?: string | null
          caller_state?: string | null
          caller_zip?: string | null
          campaign_name?: string | null
          client_id: string
          connected?: boolean | null
          connection_duration_seconds?: number | null
          created_at?: string
          creative_name?: string | null
          did?: string | null
          disposition?: string | null
          duration_seconds?: number | null
          id?: string
          payout?: number | null
          platform?: string | null
          raw_payload?: Json | null
          recording_url?: string | null
        }
        Update: {
          call_id?: string
          call_start?: string
          caller_area_code?: string | null
          caller_city?: string | null
          caller_number?: string | null
          caller_state?: string | null
          caller_zip?: string | null
          campaign_name?: string | null
          client_id?: string
          connected?: boolean | null
          connection_duration_seconds?: number | null
          created_at?: string
          creative_name?: string | null
          did?: string | null
          disposition?: string | null
          duration_seconds?: number | null
          id?: string
          payout?: number | null
          platform?: string | null
          raw_payload?: Json | null
          recording_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cannaball_calls_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      cannaball_spend: {
        Row: {
          campaign_name: string | null
          clicks: number | null
          client_id: string
          created_at: string
          creative_name: string | null
          date: string
          id: string
          impressions: number | null
          platform: string
          raw: Json | null
          spend: number
          updated_at: string
        }
        Insert: {
          campaign_name?: string | null
          clicks?: number | null
          client_id: string
          created_at?: string
          creative_name?: string | null
          date: string
          id?: string
          impressions?: number | null
          platform?: string
          raw?: Json | null
          spend?: number
          updated_at?: string
        }
        Update: {
          campaign_name?: string | null
          clicks?: number | null
          client_id?: string
          created_at?: string
          creative_name?: string | null
          date?: string
          id?: string
          impressions?: number | null
          platform?: string
          raw?: Json | null
          spend?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cannaball_spend_client_id_fkey"
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
      client_context: {
        Row: {
          ai_summary: Json | null
          client_id: string
          full_context: Json
          id: string
          last_updated: string
        }
        Insert: {
          ai_summary?: Json | null
          client_id: string
          full_context?: Json
          id?: string
          last_updated?: string
        }
        Update: {
          ai_summary?: Json | null
          client_id?: string
          full_context?: Json
          id?: string
          last_updated?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_context_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_daily_updates: {
        Row: {
          am_notes: string | null
          client_id: string
          created_at: string
          draft_text: string
          edited_by_id: string | null
          final_text: string | null
          for_date: string
          id: string
          kind: string
          metrics: Json
          sent_at: string | null
          slack_channel_id: string | null
          slack_ts: string | null
          status: string
          updated_at: string
        }
        Insert: {
          am_notes?: string | null
          client_id: string
          created_at?: string
          draft_text: string
          edited_by_id?: string | null
          final_text?: string | null
          for_date: string
          id?: string
          kind?: string
          metrics?: Json
          sent_at?: string | null
          slack_channel_id?: string | null
          slack_ts?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          am_notes?: string | null
          client_id?: string
          created_at?: string
          draft_text?: string
          edited_by_id?: string | null
          final_text?: string | null
          for_date?: string
          id?: string
          kind?: string
          metrics?: Json
          sent_at?: string | null
          slack_channel_id?: string | null
          slack_ts?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_daily_updates_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_daily_updates_edited_by_id_fkey"
            columns: ["edited_by_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      client_did_history: {
        Row: {
          ad_length: string | null
          audience_cluster: string | null
          campaign_name: string | null
          changed_at: string
          changed_by_id: string | null
          creative_name: string | null
          did_id: string
          id: string
          platform: string | null
          status: string | null
        }
        Insert: {
          ad_length?: string | null
          audience_cluster?: string | null
          campaign_name?: string | null
          changed_at?: string
          changed_by_id?: string | null
          creative_name?: string | null
          did_id: string
          id?: string
          platform?: string | null
          status?: string | null
        }
        Update: {
          ad_length?: string | null
          audience_cluster?: string | null
          campaign_name?: string | null
          changed_at?: string
          changed_by_id?: string | null
          creative_name?: string | null
          did_id?: string
          id?: string
          platform?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_did_history_changed_by_id_fkey"
            columns: ["changed_by_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_did_history_did_id_fkey"
            columns: ["did_id"]
            isOneToOne: false
            referencedRelation: "client_dids"
            referencedColumns: ["id"]
          },
        ]
      }
      client_did_periods: {
        Row: {
          campaign_name: string | null
          client_id: string
          created_at: string
          creative_name: string
          did: string
          did_formatted: string | null
          effective_from: string
          effective_to: string | null
          id: string
          notes: string | null
          platform: string
          updated_at: string
        }
        Insert: {
          campaign_name?: string | null
          client_id: string
          created_at?: string
          creative_name: string
          did: string
          did_formatted?: string | null
          effective_from: string
          effective_to?: string | null
          id?: string
          notes?: string | null
          platform?: string
          updated_at?: string
        }
        Update: {
          campaign_name?: string | null
          client_id?: string
          created_at?: string
          creative_name?: string
          did?: string
          did_formatted?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          notes?: string | null
          platform?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_did_periods_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_dids: {
        Row: {
          ad_length: string | null
          assigned_at: string
          assigned_by_id: string | null
          audience_cluster: string | null
          campaign_name: string | null
          client_id: string
          created_at: string
          creative_name: string | null
          did: string
          did_formatted: string | null
          id: string
          notes: string | null
          platform: string | null
          status: string
          targeting_notes: string | null
          updated_at: string
        }
        Insert: {
          ad_length?: string | null
          assigned_at?: string
          assigned_by_id?: string | null
          audience_cluster?: string | null
          campaign_name?: string | null
          client_id: string
          created_at?: string
          creative_name?: string | null
          did: string
          did_formatted?: string | null
          id?: string
          notes?: string | null
          platform?: string | null
          status?: string
          targeting_notes?: string | null
          updated_at?: string
        }
        Update: {
          ad_length?: string | null
          assigned_at?: string
          assigned_by_id?: string | null
          audience_cluster?: string | null
          campaign_name?: string | null
          client_id?: string
          created_at?: string
          creative_name?: string | null
          did?: string
          did_formatted?: string | null
          id?: string
          notes?: string | null
          platform?: string | null
          status?: string
          targeting_notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_dids_assigned_by_id_fkey"
            columns: ["assigned_by_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_dids_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
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
      client_invites: {
        Row: {
          accepted_at: string | null
          client_id: string
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by_id: string | null
          role: string
          status: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          client_id: string
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by_id?: string | null
          role?: string
          status?: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          client_id?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by_id?: string | null
          role?: string
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_invites_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_invites_invited_by_id_fkey"
            columns: ["invited_by_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      client_slack_reports: {
        Row: {
          client_id: string
          created_at: string
          day_of_week: number
          enabled: boolean
          id: string
          last_error: string | null
          last_period_key: string | null
          last_sent_at: string | null
          lease_until: string | null
          notes: string | null
          run_hour_utc: number
          scope: string
          slack_channel_id: string | null
          slack_channel_name: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          day_of_week?: number
          enabled?: boolean
          id?: string
          last_error?: string | null
          last_period_key?: string | null
          last_sent_at?: string | null
          lease_until?: string | null
          notes?: string | null
          run_hour_utc?: number
          scope: string
          slack_channel_id?: string | null
          slack_channel_name?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          day_of_week?: number
          enabled?: boolean
          id?: string
          last_error?: string | null
          last_period_key?: string | null
          last_sent_at?: string | null
          lease_until?: string | null
          notes?: string | null
          run_hour_utc?: number
          scope?: string
          slack_channel_id?: string | null
          slack_channel_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_slack_reports_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_users: {
        Row: {
          client_id: string
          client_role: string
          created_at: string
          display_name: string | null
          id: string
          onboarding_token_id: string | null
          user_id: string
        }
        Insert: {
          client_id: string
          client_role?: string
          created_at?: string
          display_name?: string | null
          id?: string
          onboarding_token_id?: string | null
          user_id: string
        }
        Update: {
          client_id?: string
          client_role?: string
          created_at?: string
          display_name?: string | null
          id?: string
          onboarding_token_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_users_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_users_onboarding_token_id_fkey"
            columns: ["onboarding_token_id"]
            isOneToOne: false
            referencedRelation: "onboarding_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      client_verticals: {
        Row: {
          client_id: string
          created_at: string
          emoji: string
          google_account_ids: string[]
          google_patterns: string[]
          id: string
          label: string
          meta_account_ids: string[]
          meta_patterns: string[]
          position: number
          ringba_exact_match: boolean
          ringba_patterns: string[]
          updated_at: string
          vertical_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          emoji?: string
          google_account_ids?: string[]
          google_patterns?: string[]
          id?: string
          label: string
          meta_account_ids?: string[]
          meta_patterns?: string[]
          position?: number
          ringba_exact_match?: boolean
          ringba_patterns?: string[]
          updated_at?: string
          vertical_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          emoji?: string
          google_account_ids?: string[]
          google_patterns?: string[]
          id?: string
          label?: string
          meta_account_ids?: string[]
          meta_patterns?: string[]
          position?: number
          ringba_exact_match?: boolean
          ringba_patterns?: string[]
          updated_at?: string
          vertical_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_verticals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          color: string | null
          communication_channel: string | null
          created_at: string
          data_model_note: string | null
          engagement_type: string | null
          expected_sources: string[]
          external_dashboard_url: string | null
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
          data_model_note?: string | null
          engagement_type?: string | null
          expected_sources?: string[]
          external_dashboard_url?: string | null
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
          data_model_note?: string | null
          engagement_type?: string | null
          expected_sources?: string[]
          external_dashboard_url?: string | null
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
          client_id: string | null
          content: string | null
          content_type: string
          created_at: string
          id: string
          metadata: Json | null
          occurred_at: string
          participants: string[] | null
          search_vector: unknown
          source: string
          source_id: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          content?: string | null
          content_type: string
          created_at?: string
          id?: string
          metadata?: Json | null
          occurred_at?: string
          participants?: string[] | null
          search_vector?: unknown
          source: string
          source_id?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          content?: string | null
          content_type?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          occurred_at?: string
          participants?: string[] | null
          search_vector?: unknown
          source?: string
          source_id?: string | null
          title?: string | null
          updated_at?: string
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
          client_id: string | null
          created_at: string
          error_message: string | null
          id: string
          items_synced: number | null
          last_sync_at: string | null
          source: string
          status: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          items_synced?: number | null
          last_sync_at?: string | null
          source: string
          status?: string
        }
        Update: {
          client_id?: string | null
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
          deleted_at: string | null
          delivered_at: string | null
          dos_and_donts: string | null
          drive_approved_folder_id: string | null
          drive_wip_folder_id: string | null
          due_date: string | null
          estimated_hours: number | null
          final_assets_url: string | null
          funnel_stage: string | null
          id: string
          key_message: string | null
          notes: string | null
          num_concepts: number | null
          objective: string | null
          platforms: string[] | null
          priority: string
          raw_footage_url: string | null
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
          deleted_at?: string | null
          delivered_at?: string | null
          dos_and_donts?: string | null
          drive_approved_folder_id?: string | null
          drive_wip_folder_id?: string | null
          due_date?: string | null
          estimated_hours?: number | null
          final_assets_url?: string | null
          funnel_stage?: string | null
          id?: string
          key_message?: string | null
          notes?: string | null
          num_concepts?: number | null
          objective?: string | null
          platforms?: string[] | null
          priority?: string
          raw_footage_url?: string | null
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
          deleted_at?: string | null
          delivered_at?: string | null
          dos_and_donts?: string | null
          drive_approved_folder_id?: string | null
          drive_wip_folder_id?: string | null
          due_date?: string | null
          estimated_hours?: number | null
          final_assets_url?: string | null
          funnel_stage?: string | null
          id?: string
          key_message?: string | null
          notes?: string | null
          num_concepts?: number | null
          objective?: string | null
          platforms?: string[] | null
          priority?: string
          raw_footage_url?: string | null
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
          brief_id: string | null
          category: string
          client_id: string | null
          created_at: string
          deleted_at: string | null
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
          brief_id?: string | null
          category?: string
          client_id?: string | null
          created_at?: string
          deleted_at?: string | null
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
          brief_id?: string | null
          category?: string
          client_id?: string | null
          created_at?: string
          deleted_at?: string | null
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
      cron_invocation_tokens: {
        Row: {
          created_at: string
          job_name: string
          token: string
        }
        Insert: {
          created_at?: string
          job_name: string
          token?: string
        }
        Update: {
          created_at?: string
          job_name?: string
          token?: string
        }
        Relationships: []
      }
      daily_update_style: {
        Row: {
          created_at: string
          example_text: string
          guidance: string
          id: string
          is_active: boolean
          key: string
          label: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          example_text?: string
          guidance?: string
          id?: string
          is_active?: boolean
          key: string
          label: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          example_text?: string
          guidance?: string
          id?: string
          is_active?: boolean
          key?: string
          label?: string
          updated_at?: string
        }
        Relationships: []
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
      data_integrity_exceptions: {
        Row: {
          check_key: string
          client_id: string | null
          created_at: string
          created_by_id: string | null
          expires_at: string | null
          id: string
          reason: string
        }
        Insert: {
          check_key: string
          client_id?: string | null
          created_at?: string
          created_by_id?: string | null
          expires_at?: string | null
          id?: string
          reason: string
        }
        Update: {
          check_key?: string
          client_id?: string | null
          created_at?: string
          created_by_id?: string | null
          expires_at?: string | null
          id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_integrity_exceptions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_integrity_exceptions_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "team_members"
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
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      jacuzzi_delivery: {
        Row: {
          campaign_name: string | null
          client_id: string
          cpm: number
          created_at: string
          date: string
          id: string
          impressions: number
          source: string
          spend: number
          station_code: string
          updated_at: string
        }
        Insert: {
          campaign_name?: string | null
          client_id: string
          cpm?: number
          created_at?: string
          date: string
          id?: string
          impressions?: number
          source?: string
          spend?: number
          station_code: string
          updated_at?: string
        }
        Update: {
          campaign_name?: string | null
          client_id?: string
          cpm?: number
          created_at?: string
          date?: string
          id?: string
          impressions?: number
          source?: string
          spend?: number
          station_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jacuzzi_delivery_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      jacuzzi_hourly_delivery: {
        Row: {
          client_id: string
          created_at: string
          date: string
          hour: number
          id: string
          impressions: number
          source: string
          spend: number
          station_code: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          date: string
          hour: number
          id?: string
          impressions?: number
          source?: string
          spend?: number
          station_code?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          date?: string
          hour?: number
          id?: string
          impressions?: number
          source?: string
          spend?: number
          station_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jacuzzi_hourly_delivery_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      jacuzzi_leads: {
        Row: {
          area_code: string | null
          attributed_station: string | null
          billing_city: string | null
          billing_state: string | null
          billing_zip: string | null
          call_status: string | null
          caller_ani: string | null
          client_id: string
          created_at: string
          id: string
          lead_type: string
          notes: string | null
          payout_rate: number
          raw: Json | null
          source: string
          station_code: string | null
          toll_free_number: string | null
          transaction_date: string
          transaction_id: string
          transaction_time: string | null
          updated_at: string
        }
        Insert: {
          area_code?: string | null
          attributed_station?: string | null
          billing_city?: string | null
          billing_state?: string | null
          billing_zip?: string | null
          call_status?: string | null
          caller_ani?: string | null
          client_id: string
          created_at?: string
          id?: string
          lead_type?: string
          notes?: string | null
          payout_rate?: number
          raw?: Json | null
          source?: string
          station_code?: string | null
          toll_free_number?: string | null
          transaction_date: string
          transaction_id: string
          transaction_time?: string | null
          updated_at?: string
        }
        Update: {
          area_code?: string | null
          attributed_station?: string | null
          billing_city?: string | null
          billing_state?: string | null
          billing_zip?: string | null
          call_status?: string | null
          caller_ani?: string | null
          client_id?: string
          created_at?: string
          id?: string
          lead_type?: string
          notes?: string | null
          payout_rate?: number
          raw?: Json | null
          source?: string
          station_code?: string | null
          toll_free_number?: string | null
          transaction_date?: string
          transaction_id?: string
          transaction_time?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jacuzzi_leads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      jacuzzi_payout_rates: {
        Row: {
          client_id: string
          created_at: string
          effective_from: string
          id: string
          rate: number
        }
        Insert: {
          client_id: string
          created_at?: string
          effective_from: string
          id?: string
          rate: number
        }
        Update: {
          client_id?: string
          created_at?: string
          effective_from?: string
          id?: string
          rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "jacuzzi_payout_rates_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      jacuzzi_reconciliation_daily: {
        Row: {
          applied_rate: number
          by_station: Json
          call_leads: number
          client_id: string
          created_at: string
          date: string
          expected_revenue: number
          generated_at: string
          id: string
          leads_total: number
          matched_count: number
          qr_leads: number
          rate_effective_from: string | null
          rate_mismatches: number
          ringfuel_calls: number
          station_mismatches: number
          unmatched_calls: number
          unmatched_leads: number
          updated_at: string
        }
        Insert: {
          applied_rate?: number
          by_station?: Json
          call_leads?: number
          client_id: string
          created_at?: string
          date: string
          expected_revenue?: number
          generated_at?: string
          id?: string
          leads_total?: number
          matched_count?: number
          qr_leads?: number
          rate_effective_from?: string | null
          rate_mismatches?: number
          ringfuel_calls?: number
          station_mismatches?: number
          unmatched_calls?: number
          unmatched_leads?: number
          updated_at?: string
        }
        Update: {
          applied_rate?: number
          by_station?: Json
          call_leads?: number
          client_id?: string
          created_at?: string
          date?: string
          expected_revenue?: number
          generated_at?: string
          id?: string
          leads_total?: number
          matched_count?: number
          qr_leads?: number
          rate_effective_from?: string | null
          rate_mismatches?: number
          ringfuel_calls?: number
          station_mismatches?: number
          unmatched_calls?: number
          unmatched_leads?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jacuzzi_reconciliation_daily_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      jacuzzi_reconciliation_matches: {
        Row: {
          caller_number: string | null
          client_id: string
          created_at: string
          date: string
          expected_rate: number | null
          id: string
          lead_id: string | null
          lead_payout_rate: number | null
          lead_station: string | null
          lead_type: string | null
          match_method: string | null
          notes: string | null
          rate_agrees: boolean | null
          ringfuel_call_id: string | null
          ringfuel_did: string | null
          ringfuel_station: string | null
          station_agrees: boolean | null
          status: string
          transaction_id: string | null
        }
        Insert: {
          caller_number?: string | null
          client_id: string
          created_at?: string
          date: string
          expected_rate?: number | null
          id?: string
          lead_id?: string | null
          lead_payout_rate?: number | null
          lead_station?: string | null
          lead_type?: string | null
          match_method?: string | null
          notes?: string | null
          rate_agrees?: boolean | null
          ringfuel_call_id?: string | null
          ringfuel_did?: string | null
          ringfuel_station?: string | null
          station_agrees?: boolean | null
          status: string
          transaction_id?: string | null
        }
        Update: {
          caller_number?: string | null
          client_id?: string
          created_at?: string
          date?: string
          expected_rate?: number | null
          id?: string
          lead_id?: string | null
          lead_payout_rate?: number | null
          lead_station?: string | null
          lead_type?: string | null
          match_method?: string | null
          notes?: string | null
          rate_agrees?: boolean | null
          ringfuel_call_id?: string | null
          ringfuel_did?: string | null
          ringfuel_station?: string | null
          station_agrees?: boolean | null
          status?: string
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jacuzzi_reconciliation_matches_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
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
      leads: {
        Row: {
          company_name: string
          company_revenue: string | null
          created_at: string
          email: string
          first_name: string
          id: string
          last_name: string
          monthly_ad_spend: string | null
          notes: string | null
          num_hub_users: string | null
          phone: string | null
          source: string
          status: string
          updated_at: string
          use_cases: string[] | null
          user_id: string | null
        }
        Insert: {
          company_name: string
          company_revenue?: string | null
          created_at?: string
          email: string
          first_name: string
          id?: string
          last_name: string
          monthly_ad_spend?: string | null
          notes?: string | null
          num_hub_users?: string | null
          phone?: string | null
          source?: string
          status?: string
          updated_at?: string
          use_cases?: string[] | null
          user_id?: string | null
        }
        Update: {
          company_name?: string
          company_revenue?: string | null
          created_at?: string
          email?: string
          first_name?: string
          id?: string
          last_name?: string
          monthly_ad_spend?: string | null
          notes?: string | null
          num_hub_users?: string | null
          phone?: string | null
          source?: string
          status?: string
          updated_at?: string
          use_cases?: string[] | null
          user_id?: string | null
        }
        Relationships: []
      }
      media_brain_change_log: {
        Row: {
          change_date: string
          change_description: string
          client_id: string
          created_at: string | null
          created_by_id: string | null
          entity_level: string | null
          entity_name: string | null
          entity_ref: string | null
          expected_result: string
          id: string
          is_changepoint: boolean
          outcome: string | null
          review_date: string
          reviewed_at: string | null
          why: string
        }
        Insert: {
          change_date?: string
          change_description: string
          client_id: string
          created_at?: string | null
          created_by_id?: string | null
          entity_level?: string | null
          entity_name?: string | null
          entity_ref?: string | null
          expected_result: string
          id?: string
          is_changepoint?: boolean
          outcome?: string | null
          review_date: string
          reviewed_at?: string | null
          why: string
        }
        Update: {
          change_date?: string
          change_description?: string
          client_id?: string
          created_at?: string | null
          created_by_id?: string | null
          entity_level?: string | null
          entity_name?: string | null
          entity_ref?: string | null
          expected_result?: string
          id?: string
          is_changepoint?: boolean
          outcome?: string | null
          review_date?: string
          reviewed_at?: string | null
          why?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_brain_change_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      media_brain_dispositions: {
        Row: {
          awaiting_evidence: string | null
          client_id: string
          confidence_state: string | null
          created_at: string | null
          decided_at: string | null
          decided_by_id: string | null
          entity_level: string
          entity_name: string | null
          entity_ref: string
          evidence: Json | null
          id: string
          instance_id: string | null
          reason: string | null
          review_date: string | null
          review_id: string | null
          status: string
          verdict: string
        }
        Insert: {
          awaiting_evidence?: string | null
          client_id: string
          confidence_state?: string | null
          created_at?: string | null
          decided_at?: string | null
          decided_by_id?: string | null
          entity_level: string
          entity_name?: string | null
          entity_ref: string
          evidence?: Json | null
          id?: string
          instance_id?: string | null
          reason?: string | null
          review_date?: string | null
          review_id?: string | null
          status?: string
          verdict: string
        }
        Update: {
          awaiting_evidence?: string | null
          client_id?: string
          confidence_state?: string | null
          created_at?: string | null
          decided_at?: string | null
          decided_by_id?: string | null
          entity_level?: string
          entity_name?: string | null
          entity_ref?: string
          evidence?: Json | null
          id?: string
          instance_id?: string | null
          reason?: string | null
          review_date?: string | null
          review_id?: string | null
          status?: string
          verdict?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_brain_dispositions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_brain_dispositions_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "media_brain_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_brain_dispositions_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "media_brain_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      media_brain_economics: {
        Row: {
          ad_account_ids: string[] | null
          attributed_publishers: string[] | null
          avg_bid: number | null
          bid_ceiling: number | null
          bid_floor: number | null
          billable_filters: Json | null
          billable_min_duration_seconds: number | null
          buyer_hours: Json | null
          campaign_state: string | null
          client_id: string
          created_at: string | null
          daily_budget: number | null
          duration_max_seconds: number | null
          duration_min_seconds: number | null
          existing_structure_notes: string | null
          expected_cost_per_billable_call: number | null
          expected_cost_per_call: number | null
          funnel_cta: string | null
          funnel_type: string | null
          has_ivr: boolean | null
          id: string
          known_problems: string | null
          last_reviewed_at: string | null
          min_payout_threshold: number
          payout: number | null
          payout_mode: string
          platforms: string[] | null
          publisher_scoping: string
          publisher_scoping_note: string | null
          publisher_scoping_verified_at: string | null
          publisher_scoping_verified_by: string | null
          reporting_cadence: string | null
          reporting_format: string | null
          revenue_source: string
          routing_mode: string
          steps_to_live_person: number | null
          tracking_platform: string | null
          unknown_fields: string[] | null
          updated_at: string | null
          vertical: string | null
          vertical_id: string | null
        }
        Insert: {
          ad_account_ids?: string[] | null
          attributed_publishers?: string[] | null
          avg_bid?: number | null
          bid_ceiling?: number | null
          bid_floor?: number | null
          billable_filters?: Json | null
          billable_min_duration_seconds?: number | null
          buyer_hours?: Json | null
          campaign_state?: string | null
          client_id: string
          created_at?: string | null
          daily_budget?: number | null
          duration_max_seconds?: number | null
          duration_min_seconds?: number | null
          existing_structure_notes?: string | null
          expected_cost_per_billable_call?: number | null
          expected_cost_per_call?: number | null
          funnel_cta?: string | null
          funnel_type?: string | null
          has_ivr?: boolean | null
          id?: string
          known_problems?: string | null
          last_reviewed_at?: string | null
          min_payout_threshold?: number
          payout?: number | null
          payout_mode: string
          platforms?: string[] | null
          publisher_scoping?: string
          publisher_scoping_note?: string | null
          publisher_scoping_verified_at?: string | null
          publisher_scoping_verified_by?: string | null
          reporting_cadence?: string | null
          reporting_format?: string | null
          revenue_source?: string
          routing_mode?: string
          steps_to_live_person?: number | null
          tracking_platform?: string | null
          unknown_fields?: string[] | null
          updated_at?: string | null
          vertical?: string | null
          vertical_id?: string | null
        }
        Update: {
          ad_account_ids?: string[] | null
          attributed_publishers?: string[] | null
          avg_bid?: number | null
          bid_ceiling?: number | null
          bid_floor?: number | null
          billable_filters?: Json | null
          billable_min_duration_seconds?: number | null
          buyer_hours?: Json | null
          campaign_state?: string | null
          client_id?: string
          created_at?: string | null
          daily_budget?: number | null
          duration_max_seconds?: number | null
          duration_min_seconds?: number | null
          existing_structure_notes?: string | null
          expected_cost_per_billable_call?: number | null
          expected_cost_per_call?: number | null
          funnel_cta?: string | null
          funnel_type?: string | null
          has_ivr?: boolean | null
          id?: string
          known_problems?: string | null
          last_reviewed_at?: string | null
          min_payout_threshold?: number
          payout?: number | null
          payout_mode?: string
          platforms?: string[] | null
          publisher_scoping?: string
          publisher_scoping_note?: string | null
          publisher_scoping_verified_at?: string | null
          publisher_scoping_verified_by?: string | null
          reporting_cadence?: string | null
          reporting_format?: string | null
          revenue_source?: string
          routing_mode?: string
          steps_to_live_person?: number | null
          tracking_platform?: string | null
          unknown_fields?: string[] | null
          updated_at?: string | null
          vertical?: string | null
          vertical_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "media_brain_economics_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      media_brain_instances: {
        Row: {
          actionable_gap: number
          allowable_cost_per_call: number | null
          baseline_rpc: number | null
          client_id: string
          computed_at: string | null
          cost_per_angle: number | null
          created_at: string | null
          cut_cadence: string | null
          economics_id: string | null
          expected_billable_calls_per_week: number | null
          expected_meta_events_per_week: number | null
          flags: Json | null
          id: string
          is_stale: boolean | null
          kill_threshold: number | null
          lifecycle_stage: string | null
          max_angles: number | null
          meta_conversion_event: string | null
          meta_conversion_event_confirmed_at: string | null
          meta_conversion_event_confirmed_by: string | null
          min_calls: number | null
          min_margin: number
          naming_convention: Json | null
          scale_cadence: string | null
          target_margin: number
          test_budget_pct: number | null
          unknown_blocks: Json
          unknown_fields: string[]
          updated_at: string | null
          volume_tier: string | null
        }
        Insert: {
          actionable_gap?: number
          allowable_cost_per_call?: number | null
          baseline_rpc?: number | null
          client_id: string
          computed_at?: string | null
          cost_per_angle?: number | null
          created_at?: string | null
          cut_cadence?: string | null
          economics_id?: string | null
          expected_billable_calls_per_week?: number | null
          expected_meta_events_per_week?: number | null
          flags?: Json | null
          id?: string
          is_stale?: boolean | null
          kill_threshold?: number | null
          lifecycle_stage?: string | null
          max_angles?: number | null
          meta_conversion_event?: string | null
          meta_conversion_event_confirmed_at?: string | null
          meta_conversion_event_confirmed_by?: string | null
          min_calls?: number | null
          min_margin?: number
          naming_convention?: Json | null
          scale_cadence?: string | null
          target_margin?: number
          test_budget_pct?: number | null
          unknown_blocks?: Json
          unknown_fields?: string[]
          updated_at?: string | null
          volume_tier?: string | null
        }
        Update: {
          actionable_gap?: number
          allowable_cost_per_call?: number | null
          baseline_rpc?: number | null
          client_id?: string
          computed_at?: string | null
          cost_per_angle?: number | null
          created_at?: string | null
          cut_cadence?: string | null
          economics_id?: string | null
          expected_billable_calls_per_week?: number | null
          expected_meta_events_per_week?: number | null
          flags?: Json | null
          id?: string
          is_stale?: boolean | null
          kill_threshold?: number | null
          lifecycle_stage?: string | null
          max_angles?: number | null
          meta_conversion_event?: string | null
          meta_conversion_event_confirmed_at?: string | null
          meta_conversion_event_confirmed_by?: string | null
          min_calls?: number | null
          min_margin?: number
          naming_convention?: Json | null
          scale_cadence?: string | null
          target_margin?: number
          test_budget_pct?: number | null
          unknown_blocks?: Json
          unknown_fields?: string[]
          updated_at?: string | null
          volume_tier?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "media_brain_instances_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_brain_instances_economics_id_fkey"
            columns: ["economics_id"]
            isOneToOne: false
            referencedRelation: "media_brain_economics"
            referencedColumns: ["id"]
          },
        ]
      }
      media_brain_location_score_runs: {
        Row: {
          budget_daily: number | null
          client_id: string
          confidence_high: number
          confidence_min: number
          created_at: string
          created_by: string | null
          expand_tier_pct: number
          hard_fail_col: string | null
          hard_fail_rate_max: number
          id: string
          id_col: string
          launch_list_size: number
          launch_qualifying: number
          launch_size: number
          launch_tier_pct: number
          locations_excluded: number
          locations_scored: number
          locations_total: number
          min_success_rate: number
          notes: string | null
          payout_mode: string | null
          publisher_scoping_note: string | null
          run_at: string
          source: string
          source_label: string | null
          success_col: string
          updated_at: string
          value_col: string | null
          volume_col: string
          weight_redistribution_note: string | null
          weight_success: number
          weight_value: number
          weight_volume: number
        }
        Insert: {
          budget_daily?: number | null
          client_id: string
          confidence_high: number
          confidence_min: number
          created_at?: string
          created_by?: string | null
          expand_tier_pct: number
          hard_fail_col?: string | null
          hard_fail_rate_max: number
          id?: string
          id_col: string
          launch_list_size?: number
          launch_qualifying?: number
          launch_size: number
          launch_tier_pct: number
          locations_excluded?: number
          locations_scored?: number
          locations_total?: number
          min_success_rate: number
          notes?: string | null
          payout_mode?: string | null
          publisher_scoping_note?: string | null
          run_at?: string
          source: string
          source_label?: string | null
          success_col: string
          updated_at?: string
          value_col?: string | null
          volume_col: string
          weight_redistribution_note?: string | null
          weight_success: number
          weight_value: number
          weight_volume: number
        }
        Update: {
          budget_daily?: number | null
          client_id?: string
          confidence_high?: number
          confidence_min?: number
          created_at?: string
          created_by?: string | null
          expand_tier_pct?: number
          hard_fail_col?: string | null
          hard_fail_rate_max?: number
          id?: string
          id_col?: string
          launch_list_size?: number
          launch_qualifying?: number
          launch_size?: number
          launch_tier_pct?: number
          locations_excluded?: number
          locations_scored?: number
          locations_total?: number
          min_success_rate?: number
          notes?: string | null
          payout_mode?: string | null
          publisher_scoping_note?: string | null
          run_at?: string
          source?: string
          source_label?: string | null
          success_col?: string
          updated_at?: string
          value_col?: string | null
          volume_col?: string
          weight_redistribution_note?: string | null
          weight_success?: number
          weight_value?: number
          weight_volume?: number
        }
        Relationships: [
          {
            foreignKeyName: "media_brain_location_score_runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      media_brain_location_scores: {
        Row: {
          client_id: string
          confidence: string | null
          confidence_high: number
          confidence_min: number
          created_at: string
          exclude_reason: string | null
          excluded: boolean
          hard_fail: number | null
          hard_fail_col: string | null
          hard_fail_rate: number | null
          hard_fail_rate_max: number
          id: string
          id_col: string
          in_launch_list: boolean
          location_id: string
          min_success_rate: number
          run_at: string
          run_id: string
          score: number | null
          score_percentile: number | null
          source: string
          success: number
          success_col: string
          success_rate: number | null
          tier: string | null
          value: number | null
          value_col: string | null
          volume: number
          volume_col: string
          weight_success: number
          weight_value: number
          weight_volume: number
        }
        Insert: {
          client_id: string
          confidence?: string | null
          confidence_high: number
          confidence_min: number
          created_at?: string
          exclude_reason?: string | null
          excluded?: boolean
          hard_fail?: number | null
          hard_fail_col?: string | null
          hard_fail_rate?: number | null
          hard_fail_rate_max: number
          id?: string
          id_col: string
          in_launch_list?: boolean
          location_id: string
          min_success_rate: number
          run_at?: string
          run_id: string
          score?: number | null
          score_percentile?: number | null
          source: string
          success?: number
          success_col: string
          success_rate?: number | null
          tier?: string | null
          value?: number | null
          value_col?: string | null
          volume?: number
          volume_col: string
          weight_success: number
          weight_value: number
          weight_volume: number
        }
        Update: {
          client_id?: string
          confidence?: string | null
          confidence_high?: number
          confidence_min?: number
          created_at?: string
          exclude_reason?: string | null
          excluded?: boolean
          hard_fail?: number | null
          hard_fail_col?: string | null
          hard_fail_rate?: number | null
          hard_fail_rate_max?: number
          id?: string
          id_col?: string
          in_launch_list?: boolean
          location_id?: string
          min_success_rate?: number
          run_at?: string
          run_id?: string
          score?: number | null
          score_percentile?: number | null
          source?: string
          success?: number
          success_col?: string
          success_rate?: number | null
          tier?: string | null
          value?: number | null
          value_col?: string | null
          volume?: number
          volume_col?: string
          weight_success?: number
          weight_value?: number
          weight_volume?: number
        }
        Relationships: [
          {
            foreignKeyName: "media_brain_location_scores_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_brain_location_scores_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "media_brain_location_score_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      media_brain_platform_conversions: {
        Row: {
          client_id: string
          count: number
          created_at: string
          date: string
          entity_level: string
          entity_name: string | null
          entity_ref: string
          event_name: string
          id: string
          platform: string
          source: string
          updated_at: string
          value: number
        }
        Insert: {
          client_id: string
          count?: number
          created_at?: string
          date: string
          entity_level: string
          entity_name?: string | null
          entity_ref: string
          event_name: string
          id?: string
          platform: string
          source?: string
          updated_at?: string
          value?: number
        }
        Update: {
          client_id?: string
          count?: number
          created_at?: string
          date?: string
          entity_level?: string
          entity_name?: string | null
          entity_ref?: string
          event_name?: string
          id?: string
          platform?: string
          source?: string
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "media_brain_platform_conversions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      media_brain_reviews: {
        Row: {
          breakers: Json | null
          cadence: string
          client_id: string
          created_at: string | null
          created_by_id: string | null
          diagnostics: Json | null
          id: string
          instance_id: string | null
          pull_error: string | null
          pull_ok: boolean
          status: string
          timezone: string
          totals: Json | null
          window_end: string
          window_start: string
        }
        Insert: {
          breakers?: Json | null
          cadence: string
          client_id: string
          created_at?: string | null
          created_by_id?: string | null
          diagnostics?: Json | null
          id?: string
          instance_id?: string | null
          pull_error?: string | null
          pull_ok?: boolean
          status?: string
          timezone: string
          totals?: Json | null
          window_end: string
          window_start: string
        }
        Update: {
          breakers?: Json | null
          cadence?: string
          client_id?: string
          created_at?: string | null
          created_by_id?: string | null
          diagnostics?: Json | null
          id?: string
          instance_id?: string | null
          pull_error?: string | null
          pull_ok?: boolean
          status?: string
          timezone?: string
          totals?: Json | null
          window_end?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_brain_reviews_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_brain_reviews_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "media_brain_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      media_brain_sync_status: {
        Row: {
          client_id: string | null
          created_at: string
          detail: Json
          error: string | null
          id: string
          last_attempted_at: string | null
          last_succeeded_at: string | null
          rows_written: number | null
          source: string
          status: string
          token_status: string | null
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          detail?: Json
          error?: string | null
          id?: string
          last_attempted_at?: string | null
          last_succeeded_at?: string | null
          rows_written?: number | null
          source: string
          status: string
          token_status?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          detail?: Json
          error?: string | null
          id?: string
          last_attempted_at?: string | null
          last_succeeded_at?: string | null
          rows_written?: number | null
          source?: string
          status?: string
          token_status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_brain_sync_status_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_geo_metrics: {
        Row: {
          campaign_name: string | null
          clicks: number
          client_id: string
          country: string | null
          created_at: string
          date: string
          id: string
          impressions: number
          platform_campaign_id: string | null
          raw: Json | null
          region: string
          spend: number
          updated_at: string
        }
        Insert: {
          campaign_name?: string | null
          clicks?: number
          client_id: string
          country?: string | null
          created_at?: string
          date: string
          id?: string
          impressions?: number
          platform_campaign_id?: string | null
          raw?: Json | null
          region: string
          spend?: number
          updated_at?: string
        }
        Update: {
          campaign_name?: string | null
          clicks?: number
          client_id?: string
          country?: string | null
          created_at?: string
          date?: string
          id?: string
          impressions?: number
          platform_campaign_id?: string | null
          raw?: Json | null
          region?: string
          spend?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_geo_metrics_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_push_log: {
        Row: {
          action: string
          client_id: string
          created_at: string
          entity_type: string
          error_message: string | null
          id: string
          meta_entity_id: string | null
          pushed_by_id: string | null
          request_payload: Json | null
          response_payload: Json | null
          status: string
          trafficking_ad_id: string | null
          trafficking_campaign_id: string | null
        }
        Insert: {
          action: string
          client_id: string
          created_at?: string
          entity_type: string
          error_message?: string | null
          id?: string
          meta_entity_id?: string | null
          pushed_by_id?: string | null
          request_payload?: Json | null
          response_payload?: Json | null
          status: string
          trafficking_ad_id?: string | null
          trafficking_campaign_id?: string | null
        }
        Update: {
          action?: string
          client_id?: string
          created_at?: string
          entity_type?: string
          error_message?: string | null
          id?: string
          meta_entity_id?: string | null
          pushed_by_id?: string | null
          request_payload?: Json | null
          response_payload?: Json | null
          status?: string
          trafficking_ad_id?: string | null
          trafficking_campaign_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_push_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_push_log_pushed_by_id_fkey"
            columns: ["pushed_by_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_push_log_trafficking_ad_id_fkey"
            columns: ["trafficking_ad_id"]
            isOneToOne: false
            referencedRelation: "trafficking_ads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_push_log_trafficking_campaign_id_fkey"
            columns: ["trafficking_campaign_id"]
            isOneToOne: false
            referencedRelation: "trafficking_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      moja_calls: {
        Row: {
          answered: boolean | null
          buyer_name: string | null
          call_id: string
          call_start: string | null
          caller_number: string | null
          caller_state: string | null
          caller_zip: string | null
          campaign_id: string | null
          campaign_name: string | null
          client_id: string
          connected: boolean | null
          connected_source: string | null
          connected_unknown_reason: string | null
          converted: boolean
          converted_at: string | null
          created_at: string
          custom_tags: Json
          disposition: string | null
          duration_seconds: number
          duration_semantics: string
          event_type: string | null
          fbclid: string | null
          forwarded_number: string | null
          gbraid: string | null
          gclid: string | null
          hangup_cause: string | null
          id: string
          inbound_duration_seconds: number
          is_test_delivery: boolean
          msclkid: string | null
          no_payout_reason: string | null
          number_pool: string | null
          payout: number
          platform: string | null
          publisher_name: string | null
          raw_payload: Json | null
          recording_url: string | null
          reported_duration_seconds: number | null
          reported_inbound_duration_seconds: number | null
          revenue: number
          service_line: string
          target_name: string | null
          tracking_number: string | null
          updated_at: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          wbraid: string | null
        }
        Insert: {
          answered?: boolean | null
          buyer_name?: string | null
          call_id: string
          call_start?: string | null
          caller_number?: string | null
          caller_state?: string | null
          caller_zip?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          client_id: string
          connected?: boolean | null
          connected_source?: string | null
          connected_unknown_reason?: string | null
          converted?: boolean
          converted_at?: string | null
          created_at?: string
          custom_tags?: Json
          disposition?: string | null
          duration_seconds?: number
          duration_semantics?: string
          event_type?: string | null
          fbclid?: string | null
          forwarded_number?: string | null
          gbraid?: string | null
          gclid?: string | null
          hangup_cause?: string | null
          id?: string
          inbound_duration_seconds?: number
          is_test_delivery?: boolean
          msclkid?: string | null
          no_payout_reason?: string | null
          number_pool?: string | null
          payout?: number
          platform?: string | null
          publisher_name?: string | null
          raw_payload?: Json | null
          recording_url?: string | null
          reported_duration_seconds?: number | null
          reported_inbound_duration_seconds?: number | null
          revenue?: number
          service_line?: string
          target_name?: string | null
          tracking_number?: string | null
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          wbraid?: string | null
        }
        Update: {
          answered?: boolean | null
          buyer_name?: string | null
          call_id?: string
          call_start?: string | null
          caller_number?: string | null
          caller_state?: string | null
          caller_zip?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          client_id?: string
          connected?: boolean | null
          connected_source?: string | null
          connected_unknown_reason?: string | null
          converted?: boolean
          converted_at?: string | null
          created_at?: string
          custom_tags?: Json
          disposition?: string | null
          duration_seconds?: number
          duration_semantics?: string
          event_type?: string | null
          fbclid?: string | null
          forwarded_number?: string | null
          gbraid?: string | null
          gclid?: string | null
          hangup_cause?: string | null
          id?: string
          inbound_duration_seconds?: number
          is_test_delivery?: boolean
          msclkid?: string | null
          no_payout_reason?: string | null
          number_pool?: string | null
          payout?: number
          platform?: string | null
          publisher_name?: string | null
          raw_payload?: Json | null
          recording_url?: string | null
          reported_duration_seconds?: number | null
          reported_inbound_duration_seconds?: number | null
          revenue?: number
          service_line?: string
          target_name?: string | null
          tracking_number?: string | null
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          wbraid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "moja_calls_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
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
      onboarding_responses: {
        Row: {
          client_id: string
          completed_at: string | null
          created_at: string
          data: Json
          id: string
          section: string
          updated_at: string
          user_id: string
        }
        Insert: {
          client_id: string
          completed_at?: string | null
          created_at?: string
          data?: Json
          id?: string
          section: string
          updated_at?: string
          user_id: string
        }
        Update: {
          client_id?: string
          completed_at?: string | null
          created_at?: string
          data?: Json
          id?: string
          section?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_responses_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_tokens: {
        Row: {
          assigned_emails: string[] | null
          client_id: string
          client_name: string
          company: string | null
          created_at: string
          expires_at: string | null
          id: string
          kickoff_action_items: Json
          kickoff_intro: string | null
          kickoff_video_url: string | null
          status: string
          token: string
          updated_at: string
        }
        Insert: {
          assigned_emails?: string[] | null
          client_id: string
          client_name: string
          company?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          kickoff_action_items?: Json
          kickoff_intro?: string | null
          kickoff_video_url?: string | null
          status?: string
          token: string
          updated_at?: string
        }
        Update: {
          assigned_emails?: string[] | null
          client_id?: string
          client_name?: string
          company?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          kickoff_action_items?: Json
          kickoff_intro?: string | null
          kickoff_video_url?: string | null
          status?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_tokens_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
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
          customer_id: string | null
          id: string
          last_sync_records: number | null
          last_synced_at: string | null
          metadata: Json | null
          platform: string
          refresh_token: string | null
          selected_ad_account: Json | null
          status: string
          sync_error: string | null
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
          customer_id?: string | null
          id?: string
          last_sync_records?: number | null
          last_synced_at?: string | null
          metadata?: Json | null
          platform: string
          refresh_token?: string | null
          selected_ad_account?: Json | null
          status?: string
          sync_error?: string | null
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
          customer_id?: string | null
          id?: string
          last_sync_records?: number | null
          last_synced_at?: string | null
          metadata?: Json | null
          platform?: string
          refresh_token?: string | null
          selected_ad_account?: Json | null
          status?: string
          sync_error?: string | null
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
      platform_spend_4js: {
        Row: {
          audience_cluster: string | null
          campaign_name: string | null
          clicks: number | null
          client_id: string
          completed_views: number | null
          created_at: string
          creative_name: string | null
          date: string
          id: string
          impressions: number | null
          platform: string
          source: string
          spend: number | null
          updated_at: string
          uploaded_by_id: string | null
        }
        Insert: {
          audience_cluster?: string | null
          campaign_name?: string | null
          clicks?: number | null
          client_id: string
          completed_views?: number | null
          created_at?: string
          creative_name?: string | null
          date: string
          id?: string
          impressions?: number | null
          platform: string
          source?: string
          spend?: number | null
          updated_at?: string
          uploaded_by_id?: string | null
        }
        Update: {
          audience_cluster?: string | null
          campaign_name?: string | null
          clicks?: number | null
          client_id?: string
          completed_views?: number | null
          created_at?: string
          creative_name?: string | null
          date?: string
          id?: string
          impressions?: number | null
          platform?: string
          source?: string
          spend?: number | null
          updated_at?: string
          uploaded_by_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_spend_4js_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_spend_4js_uploaded_by_id_fkey"
            columns: ["uploaded_by_id"]
            isOneToOne: false
            referencedRelation: "team_members"
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
          did: string | null
          did_pool_name: string | null
          duration_seconds: number | null
          has_payout: boolean | null
          id: string
          inbound_number: string | null
          is_from_number_pool: boolean | null
          metadata: Json | null
          no_payout_reason: string | null
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
          did?: string | null
          did_pool_name?: string | null
          duration_seconds?: number | null
          has_payout?: boolean | null
          id?: string
          inbound_number?: string | null
          is_from_number_pool?: boolean | null
          metadata?: Json | null
          no_payout_reason?: string | null
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
          did?: string | null
          did_pool_name?: string | null
          duration_seconds?: number | null
          has_payout?: boolean | null
          id?: string
          inbound_number?: string | null
          is_from_number_pool?: boolean | null
          metadata?: Json | null
          no_payout_reason?: string | null
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
      ringba_calls_4js: {
        Row: {
          audience_cluster: string | null
          buyer_name: string | null
          call_duration_seconds: number | null
          call_start: string
          caller_city: string | null
          caller_number: string | null
          caller_state: string | null
          campaign_name: string | null
          client_id: string
          connected: boolean | null
          connection_duration_seconds: number | null
          created_at: string
          creative_name: string | null
          did: string
          disposition: string | null
          id: string
          payout: number | null
          platform: string | null
          publisher_name: string | null
          ringba_call_id: string
          tags: Json | null
          target_name: string | null
        }
        Insert: {
          audience_cluster?: string | null
          buyer_name?: string | null
          call_duration_seconds?: number | null
          call_start: string
          caller_city?: string | null
          caller_number?: string | null
          caller_state?: string | null
          campaign_name?: string | null
          client_id: string
          connected?: boolean | null
          connection_duration_seconds?: number | null
          created_at?: string
          creative_name?: string | null
          did: string
          disposition?: string | null
          id?: string
          payout?: number | null
          platform?: string | null
          publisher_name?: string | null
          ringba_call_id: string
          tags?: Json | null
          target_name?: string | null
        }
        Update: {
          audience_cluster?: string | null
          buyer_name?: string | null
          call_duration_seconds?: number | null
          call_start?: string
          caller_city?: string | null
          caller_number?: string | null
          caller_state?: string | null
          campaign_name?: string | null
          client_id?: string
          connected?: boolean | null
          connection_duration_seconds?: number | null
          created_at?: string
          creative_name?: string | null
          did?: string
          disposition?: string | null
          id?: string
          payout?: number | null
          platform?: string | null
          publisher_name?: string | null
          ringba_call_id?: string
          tags?: Json | null
          target_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ringba_calls_4js_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      ringfuel_calls: {
        Row: {
          buyer_name: string | null
          call_id: string
          call_start: string
          caller_city: string | null
          caller_number: string | null
          caller_state: string | null
          campaign_id: string | null
          campaign_name: string | null
          client_id: string
          connected: boolean
          connection_duration_seconds: number
          conversion_captured: boolean | null
          converted: boolean
          created_at: string
          creative_label: string | null
          did: string | null
          disposition: string | null
          duration_seconds: number
          event_type: string | null
          events_seen: string[]
          id: string
          payload_shape: string | null
          payout: number
          raw_payload: Json | null
          recording_url: string | null
          revenue: number
          revenue_captured: boolean | null
          target_name: string | null
          updated_at: string
        }
        Insert: {
          buyer_name?: string | null
          call_id: string
          call_start?: string
          caller_city?: string | null
          caller_number?: string | null
          caller_state?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          client_id: string
          connected?: boolean
          connection_duration_seconds?: number
          conversion_captured?: boolean | null
          converted?: boolean
          created_at?: string
          creative_label?: string | null
          did?: string | null
          disposition?: string | null
          duration_seconds?: number
          event_type?: string | null
          events_seen?: string[]
          id?: string
          payload_shape?: string | null
          payout?: number
          raw_payload?: Json | null
          recording_url?: string | null
          revenue?: number
          revenue_captured?: boolean | null
          target_name?: string | null
          updated_at?: string
        }
        Update: {
          buyer_name?: string | null
          call_id?: string
          call_start?: string
          caller_city?: string | null
          caller_number?: string | null
          caller_state?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          client_id?: string
          connected?: boolean
          connection_duration_seconds?: number
          conversion_captured?: boolean | null
          converted?: boolean
          created_at?: string
          creative_label?: string | null
          did?: string | null
          disposition?: string | null
          duration_seconds?: number
          event_type?: string | null
          events_seen?: string[]
          id?: string
          payload_shape?: string | null
          payout?: number
          raw_payload?: Json | null
          recording_url?: string | null
          revenue?: number
          revenue_captured?: boolean | null
          target_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ringfuel_calls_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      ringfuel_numbers: {
        Row: {
          campaign_label: string
          client_id: string
          created_at: string
          creative_label: string | null
          id: string
          minted_by_id: string | null
          phone_number: string
          raw_response: Json | null
          ringfuel_campaign_id: string
          session_id: string | null
          status: string
          tags: Json | null
          updated_at: string
          visitor_id: string | null
        }
        Insert: {
          campaign_label: string
          client_id: string
          created_at?: string
          creative_label?: string | null
          id?: string
          minted_by_id?: string | null
          phone_number: string
          raw_response?: Json | null
          ringfuel_campaign_id: string
          session_id?: string | null
          status?: string
          tags?: Json | null
          updated_at?: string
          visitor_id?: string | null
        }
        Update: {
          campaign_label?: string
          client_id?: string
          created_at?: string
          creative_label?: string | null
          id?: string
          minted_by_id?: string | null
          phone_number?: string
          raw_response?: Json | null
          ringfuel_campaign_id?: string
          session_id?: string | null
          status?: string
          tags?: Json | null
          updated_at?: string
          visitor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ringfuel_numbers_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ringfuel_numbers_minted_by_id_fkey"
            columns: ["minted_by_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      roku_daily_metrics: {
        Row: {
          account_uid: string
          campaign_name: string | null
          campaign_uid: string | null
          clicks: number
          client_id: string
          created_at: string
          date: string
          entity: string
          entity_name: string | null
          entity_uid: string
          fields: Json
          id: string
          impressions: number
          reach: number
          spend: number
          updated_at: string
          video_completions: number
        }
        Insert: {
          account_uid: string
          campaign_name?: string | null
          campaign_uid?: string | null
          clicks?: number
          client_id: string
          created_at?: string
          date: string
          entity?: string
          entity_name?: string | null
          entity_uid: string
          fields?: Json
          id?: string
          impressions?: number
          reach?: number
          spend?: number
          updated_at?: string
          video_completions?: number
        }
        Update: {
          account_uid?: string
          campaign_name?: string | null
          campaign_uid?: string | null
          clicks?: number
          client_id?: string
          created_at?: string
          date?: string
          entity?: string
          entity_name?: string | null
          entity_uid?: string
          fields?: Json
          id?: string
          impressions?: number
          reach?: number
          spend?: number
          updated_at?: string
          video_completions?: number
        }
        Relationships: [
          {
            foreignKeyName: "roku_daily_metrics_client_id_fkey"
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
      shoot_brief_comments: {
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
            foreignKeyName: "shoot_brief_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shoot_brief_comments_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "shoot_briefs"
            referencedColumns: ["id"]
          },
        ]
      }
      shoot_brief_status_history: {
        Row: {
          brief_id: string
          changed_at: string
          changed_by_id: string | null
          from_status: string | null
          id: string
          to_status: string
        }
        Insert: {
          brief_id: string
          changed_at?: string
          changed_by_id?: string | null
          from_status?: string | null
          id?: string
          to_status: string
        }
        Update: {
          brief_id?: string
          changed_at?: string
          changed_by_id?: string | null
          from_status?: string | null
          id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "shoot_brief_status_history_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "shoot_briefs"
            referencedColumns: ["id"]
          },
        ]
      }
      shoot_briefs: {
        Row: {
          actual_total: number | null
          age_range: string | null
          assigned_producer_id: string | null
          audio_setup: string | null
          branding: string
          broll_shot_list: Json | null
          camera_setup: string | null
          canceled_at: string | null
          client_ids: string[] | null
          content_deadline: string | null
          created_at: string
          created_by_id: string | null
          delivered_at: string | null
          drive_footage_folder_url: string | null
          estimated_actor_cost: number | null
          estimated_crew_cost: number | null
          estimated_equipment_cost: number | null
          estimated_location_cost: number | null
          estimated_shoot_hours: number | null
          estimated_total: number | null
          estimated_travel_cost: number | null
          footage_uploaded_at: string | null
          gender_preference: string | null
          id: string
          lighting_notes: string | null
          linked_creative_brief_id: string | null
          location_confirmed: boolean | null
          location_cost: number | null
          location_id: string | null
          location_notes: string | null
          location_type: string | null
          new_actor_ok: boolean | null
          num_actors: number | null
          num_scripts: number | null
          orientations: string[] | null
          platforms: string[] | null
          post_prod_handoff_at: string | null
          priority: string
          production_started_at: string | null
          scheduled_at: string | null
          shoot_date: string | null
          shoot_deadline: string | null
          shoot_end_time: string | null
          shoot_start_time: string | null
          shoot_types: string[] | null
          specialties_needed: string[] | null
          status: string
          support_crew_notes: string | null
          takes_per_script: number | null
          target_script_length: string | null
          title: string
          updated_at: string
          verticals: string[] | null
        }
        Insert: {
          actual_total?: number | null
          age_range?: string | null
          assigned_producer_id?: string | null
          audio_setup?: string | null
          branding?: string
          broll_shot_list?: Json | null
          camera_setup?: string | null
          canceled_at?: string | null
          client_ids?: string[] | null
          content_deadline?: string | null
          created_at?: string
          created_by_id?: string | null
          delivered_at?: string | null
          drive_footage_folder_url?: string | null
          estimated_actor_cost?: number | null
          estimated_crew_cost?: number | null
          estimated_equipment_cost?: number | null
          estimated_location_cost?: number | null
          estimated_shoot_hours?: number | null
          estimated_total?: number | null
          estimated_travel_cost?: number | null
          footage_uploaded_at?: string | null
          gender_preference?: string | null
          id?: string
          lighting_notes?: string | null
          linked_creative_brief_id?: string | null
          location_confirmed?: boolean | null
          location_cost?: number | null
          location_id?: string | null
          location_notes?: string | null
          location_type?: string | null
          new_actor_ok?: boolean | null
          num_actors?: number | null
          num_scripts?: number | null
          orientations?: string[] | null
          platforms?: string[] | null
          post_prod_handoff_at?: string | null
          priority?: string
          production_started_at?: string | null
          scheduled_at?: string | null
          shoot_date?: string | null
          shoot_deadline?: string | null
          shoot_end_time?: string | null
          shoot_start_time?: string | null
          shoot_types?: string[] | null
          specialties_needed?: string[] | null
          status?: string
          support_crew_notes?: string | null
          takes_per_script?: number | null
          target_script_length?: string | null
          title: string
          updated_at?: string
          verticals?: string[] | null
        }
        Update: {
          actual_total?: number | null
          age_range?: string | null
          assigned_producer_id?: string | null
          audio_setup?: string | null
          branding?: string
          broll_shot_list?: Json | null
          camera_setup?: string | null
          canceled_at?: string | null
          client_ids?: string[] | null
          content_deadline?: string | null
          created_at?: string
          created_by_id?: string | null
          delivered_at?: string | null
          drive_footage_folder_url?: string | null
          estimated_actor_cost?: number | null
          estimated_crew_cost?: number | null
          estimated_equipment_cost?: number | null
          estimated_location_cost?: number | null
          estimated_shoot_hours?: number | null
          estimated_total?: number | null
          estimated_travel_cost?: number | null
          footage_uploaded_at?: string | null
          gender_preference?: string | null
          id?: string
          lighting_notes?: string | null
          linked_creative_brief_id?: string | null
          location_confirmed?: boolean | null
          location_cost?: number | null
          location_id?: string | null
          location_notes?: string | null
          location_type?: string | null
          new_actor_ok?: boolean | null
          num_actors?: number | null
          num_scripts?: number | null
          orientations?: string[] | null
          platforms?: string[] | null
          post_prod_handoff_at?: string | null
          priority?: string
          production_started_at?: string | null
          scheduled_at?: string | null
          shoot_date?: string | null
          shoot_deadline?: string | null
          shoot_end_time?: string | null
          shoot_start_time?: string | null
          shoot_types?: string[] | null
          specialties_needed?: string[] | null
          status?: string
          support_crew_notes?: string | null
          takes_per_script?: number | null
          target_script_length?: string | null
          title?: string
          updated_at?: string
          verticals?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "shoot_briefs_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "shoot_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      shoot_cast: {
        Row: {
          actor_id: string
          actual_hours: number | null
          brief_id: string
          confirmed_at: string | null
          created_at: string
          estimated_hours: number | null
          hourly_rate: number | null
          id: string
          is_first_shoot: boolean | null
          payment_status: string
          producer_notes_for_shoot: string | null
          producer_rating_for_shoot: number | null
          role_description: string | null
          status: string
          total_payment: number | null
        }
        Insert: {
          actor_id: string
          actual_hours?: number | null
          brief_id: string
          confirmed_at?: string | null
          created_at?: string
          estimated_hours?: number | null
          hourly_rate?: number | null
          id?: string
          is_first_shoot?: boolean | null
          payment_status?: string
          producer_notes_for_shoot?: string | null
          producer_rating_for_shoot?: number | null
          role_description?: string | null
          status?: string
          total_payment?: number | null
        }
        Update: {
          actor_id?: string
          actual_hours?: number | null
          brief_id?: string
          confirmed_at?: string | null
          created_at?: string
          estimated_hours?: number | null
          hourly_rate?: number | null
          id?: string
          is_first_shoot?: boolean | null
          payment_status?: string
          producer_notes_for_shoot?: string | null
          producer_rating_for_shoot?: number | null
          role_description?: string | null
          status?: string
          total_payment?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shoot_cast_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "talent_actors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shoot_cast_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "shoot_briefs"
            referencedColumns: ["id"]
          },
        ]
      }
      shoot_footage: {
        Row: {
          brief_id: string
          clip_type: string | null
          drive_file_id: string | null
          drive_url: string | null
          duration_seconds: number | null
          file_name: string | null
          file_size_bytes: number | null
          file_type: string | null
          file_url: string
          id: string
          is_best_take: boolean | null
          is_usable: boolean | null
          producer_notes: string | null
          script_id: string | null
          take_number: number | null
          thumbnail_url: string | null
          uploaded_at: string
          uploaded_by_id: string | null
        }
        Insert: {
          brief_id: string
          clip_type?: string | null
          drive_file_id?: string | null
          drive_url?: string | null
          duration_seconds?: number | null
          file_name?: string | null
          file_size_bytes?: number | null
          file_type?: string | null
          file_url: string
          id?: string
          is_best_take?: boolean | null
          is_usable?: boolean | null
          producer_notes?: string | null
          script_id?: string | null
          take_number?: number | null
          thumbnail_url?: string | null
          uploaded_at?: string
          uploaded_by_id?: string | null
        }
        Update: {
          brief_id?: string
          clip_type?: string | null
          drive_file_id?: string | null
          drive_url?: string | null
          duration_seconds?: number | null
          file_name?: string | null
          file_size_bytes?: number | null
          file_type?: string | null
          file_url?: string
          id?: string
          is_best_take?: boolean | null
          is_usable?: boolean | null
          producer_notes?: string | null
          script_id?: string | null
          take_number?: number | null
          thumbnail_url?: string | null
          uploaded_at?: string
          uploaded_by_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shoot_footage_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "shoot_briefs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shoot_footage_script_id_fkey"
            columns: ["script_id"]
            isOneToOne: false
            referencedRelation: "shoot_scripts"
            referencedColumns: ["id"]
          },
        ]
      }
      shoot_locations: {
        Row: {
          address: string | null
          availability_notes: string | null
          city: string
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          cost_amount: number | null
          cost_type: string | null
          created_at: string
          created_by_id: string | null
          good_for_verticals: string[] | null
          id: string
          last_used_date: string | null
          latitude: number | null
          location_type: string | null
          longitude: number | null
          name: string
          photos: Json | null
          producer_notes: string | null
          status: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          availability_notes?: string | null
          city: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          cost_amount?: number | null
          cost_type?: string | null
          created_at?: string
          created_by_id?: string | null
          good_for_verticals?: string[] | null
          id?: string
          last_used_date?: string | null
          latitude?: number | null
          location_type?: string | null
          longitude?: number | null
          name: string
          photos?: Json | null
          producer_notes?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          availability_notes?: string | null
          city?: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          cost_amount?: number | null
          cost_type?: string | null
          created_at?: string
          created_by_id?: string | null
          good_for_verticals?: string[] | null
          id?: string
          last_used_date?: string | null
          latitude?: number | null
          location_type?: string | null
          longitude?: number | null
          name?: string
          photos?: Json | null
          producer_notes?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      shoot_scripts: {
        Row: {
          brief_id: string
          client_ids: string[] | null
          created_at: string
          cta_line: string | null
          duration_estimate_seconds: number | null
          full_script: string
          hook_line: string | null
          id: string
          key_phrases: string[] | null
          position: number | null
          title: string
          tone_direction: string | null
          verticals: string[] | null
        }
        Insert: {
          brief_id: string
          client_ids?: string[] | null
          created_at?: string
          cta_line?: string | null
          duration_estimate_seconds?: number | null
          full_script?: string
          hook_line?: string | null
          id?: string
          key_phrases?: string[] | null
          position?: number | null
          title: string
          tone_direction?: string | null
          verticals?: string[] | null
        }
        Update: {
          brief_id?: string
          client_ids?: string[] | null
          created_at?: string
          cta_line?: string | null
          duration_estimate_seconds?: number | null
          full_script?: string
          hook_line?: string | null
          id?: string
          key_phrases?: string[] | null
          position?: number | null
          title?: string
          tone_direction?: string | null
          verticals?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "shoot_scripts_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "shoot_briefs"
            referencedColumns: ["id"]
          },
        ]
      }
      slack_channel_mappings: {
        Row: {
          channel_id: string
          channel_name: string
          channel_purpose: string | null
          classified_at: string | null
          client_id: string | null
          created_at: string
          id: string
          is_ext_shared: boolean | null
          is_external: boolean
          is_org_shared: boolean | null
          is_private: boolean | null
          is_shared: boolean | null
          last_synced_ts: string | null
          sync_enabled: boolean
          updated_at: string
        }
        Insert: {
          channel_id: string
          channel_name: string
          channel_purpose?: string | null
          classified_at?: string | null
          client_id?: string | null
          created_at?: string
          id?: string
          is_ext_shared?: boolean | null
          is_external?: boolean
          is_org_shared?: boolean | null
          is_private?: boolean | null
          is_shared?: boolean | null
          last_synced_ts?: string | null
          sync_enabled?: boolean
          updated_at?: string
        }
        Update: {
          channel_id?: string
          channel_name?: string
          channel_purpose?: string | null
          classified_at?: string | null
          client_id?: string | null
          created_at?: string
          id?: string
          is_ext_shared?: boolean | null
          is_external?: boolean
          is_org_shared?: boolean | null
          is_private?: boolean | null
          is_shared?: boolean | null
          last_synced_ts?: string | null
          sync_enabled?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "slack_channel_mappings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      slack_post_refusals: {
        Row: {
          channel_id: string
          channel_name: string | null
          created_at: string
          detail: Json | null
          id: string
          method: string
          reason: string
        }
        Insert: {
          channel_id: string
          channel_name?: string | null
          created_at?: string
          detail?: Json | null
          id?: string
          method: string
          reason: string
        }
        Update: {
          channel_id?: string
          channel_name?: string | null
          created_at?: string
          detail?: Json | null
          id?: string
          method?: string
          reason?: string
        }
        Relationships: []
      }
      slack_threads: {
        Row: {
          channel_id: string
          client_id: string
          created_at: string
          has_unanswered_question: boolean
          id: string
          last_polled_at: string | null
          last_reply_ts: string | null
          parent_occurred_at: string
          thread_ts: string
          updated_at: string
        }
        Insert: {
          channel_id: string
          client_id: string
          created_at?: string
          has_unanswered_question?: boolean
          id?: string
          last_polled_at?: string | null
          last_reply_ts?: string | null
          parent_occurred_at: string
          thread_ts: string
          updated_at?: string
        }
        Update: {
          channel_id?: string
          client_id?: string
          created_at?: string
          has_unanswered_question?: boolean
          id?: string
          last_polled_at?: string | null
          last_reply_ts?: string | null
          parent_occurred_at?: string
          thread_ts?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "slack_threads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      slack_token_refresh_log: {
        Row: {
          created_at: string
          detail: string | null
          expires_at: string | null
          id: string
          status: string
        }
        Insert: {
          created_at?: string
          detail?: string | null
          expires_at?: string | null
          id?: string
          status: string
        }
        Update: {
          created_at?: string
          detail?: string | null
          expires_at?: string | null
          id?: string
          status?: string
        }
        Relationships: []
      }
      slack_tokens: {
        Row: {
          bot_access_token: string
          created_at: string
          expires_at: string
          id: string
          refresh_token: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          bot_access_token: string
          created_at?: string
          expires_at: string
          id?: string
          refresh_token: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          bot_access_token?: string
          created_at?: string
          expires_at?: string
          id?: string
          refresh_token?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      talent_actors: {
        Row: {
          additional_photos: Json | null
          age_range_appearance: string | null
          bio: string | null
          city: string
          created_at: string
          demo_reel_url: string | null
          email: string
          experience_level: string | null
          full_name: string
          gender: string | null
          has_transportation: boolean | null
          headshot_url: string | null
          hourly_rate: number | null
          id: string
          instagram_handle: string | null
          languages: string[] | null
          last_shoot_date: string | null
          phone: string | null
          producer_notes: string | null
          producer_rating: number | null
          source: string | null
          specialties: string[] | null
          status: string
          total_shoots: number
          travel_radius_miles: number | null
          updated_at: string
          weekly_availability: Json | null
        }
        Insert: {
          additional_photos?: Json | null
          age_range_appearance?: string | null
          bio?: string | null
          city: string
          created_at?: string
          demo_reel_url?: string | null
          email: string
          experience_level?: string | null
          full_name: string
          gender?: string | null
          has_transportation?: boolean | null
          headshot_url?: string | null
          hourly_rate?: number | null
          id?: string
          instagram_handle?: string | null
          languages?: string[] | null
          last_shoot_date?: string | null
          phone?: string | null
          producer_notes?: string | null
          producer_rating?: number | null
          source?: string | null
          specialties?: string[] | null
          status?: string
          total_shoots?: number
          travel_radius_miles?: number | null
          updated_at?: string
          weekly_availability?: Json | null
        }
        Update: {
          additional_photos?: Json | null
          age_range_appearance?: string | null
          bio?: string | null
          city?: string
          created_at?: string
          demo_reel_url?: string | null
          email?: string
          experience_level?: string | null
          full_name?: string
          gender?: string | null
          has_transportation?: boolean | null
          headshot_url?: string | null
          hourly_rate?: number | null
          id?: string
          instagram_handle?: string | null
          languages?: string[] | null
          last_shoot_date?: string | null
          phone?: string | null
          producer_notes?: string | null
          producer_rating?: number | null
          source?: string | null
          specialties?: string[] | null
          status?: string
          total_shoots?: number
          travel_radius_miles?: number | null
          updated_at?: string
          weekly_availability?: Json | null
        }
        Relationships: []
      }
      task_candidates: {
        Row: {
          client_id: string | null
          confidence: number | null
          created_at: string
          dedupe_key: string | null
          duplicate_of_task_id: string | null
          gate_results: Json
          id: string
          merged_into_candidate_id: string | null
          owner_raw: string | null
          owner_side: string | null
          promoted_task_id: string | null
          proposed_assignee_id: string | null
          proposed_title: string
          raw_text: string
          rejected_reason: string | null
          reviewed_at: string | null
          reviewed_by_id: string | null
          source: string
          source_ref: Json
          status: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          confidence?: number | null
          created_at?: string
          dedupe_key?: string | null
          duplicate_of_task_id?: string | null
          gate_results?: Json
          id?: string
          merged_into_candidate_id?: string | null
          owner_raw?: string | null
          owner_side?: string | null
          promoted_task_id?: string | null
          proposed_assignee_id?: string | null
          proposed_title: string
          raw_text: string
          rejected_reason?: string | null
          reviewed_at?: string | null
          reviewed_by_id?: string | null
          source: string
          source_ref?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          confidence?: number | null
          created_at?: string
          dedupe_key?: string | null
          duplicate_of_task_id?: string | null
          gate_results?: Json
          id?: string
          merged_into_candidate_id?: string | null
          owner_raw?: string | null
          owner_side?: string | null
          promoted_task_id?: string | null
          proposed_assignee_id?: string | null
          proposed_title?: string
          raw_text?: string
          rejected_reason?: string | null
          reviewed_at?: string | null
          reviewed_by_id?: string | null
          source?: string
          source_ref?: Json
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_candidates_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_candidates_duplicate_of_task_id_fkey"
            columns: ["duplicate_of_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_candidates_merged_into_candidate_id_fkey"
            columns: ["merged_into_candidate_id"]
            isOneToOne: false
            referencedRelation: "task_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_candidates_promoted_task_id_fkey"
            columns: ["promoted_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_candidates_proposed_assignee_id_fkey"
            columns: ["proposed_assignee_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_candidates_reviewed_by_id_fkey"
            columns: ["reviewed_by_id"]
            isOneToOne: false
            referencedRelation: "team_members"
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
          mentioned_ids: string[]
          task_id: string
        }
        Insert: {
          author_id: string
          content: string
          created_at?: string
          id?: string
          mentioned_ids?: string[]
          task_id: string
        }
        Update: {
          author_id?: string
          content?: string
          created_at?: string
          id?: string
          mentioned_ids?: string[]
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
      task_feedback: {
        Row: {
          action: string
          candidate_id: string | null
          comment: string | null
          corrected_text: string | null
          created_at: string
          distilled_into_rule_id: string | null
          id: string
          original_text: string | null
          surface: string
          task_id: string | null
          team_member_id: string | null
        }
        Insert: {
          action: string
          candidate_id?: string | null
          comment?: string | null
          corrected_text?: string | null
          created_at?: string
          distilled_into_rule_id?: string | null
          id?: string
          original_text?: string | null
          surface: string
          task_id?: string | null
          team_member_id?: string | null
        }
        Update: {
          action?: string
          candidate_id?: string | null
          comment?: string | null
          corrected_text?: string | null
          created_at?: string
          distilled_into_rule_id?: string | null
          id?: string
          original_text?: string | null
          surface?: string
          task_id?: string | null
          team_member_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_feedback_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "task_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_feedback_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_feedback_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
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
          client_id: string | null
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
          task_type: string
          title: string
          type_data: Json
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          client_id?: string | null
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
          task_type?: string
          title: string
          type_data?: Json
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          client_id?: string | null
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
          task_type?: string
          title?: string
          type_data?: Json
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
      team_invites: {
        Row: {
          created_at: string
          created_by: string | null
          email: string
          expires_at: string
          id: string
          name: string
          redeemed_at: string | null
          role: string
          token: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email: string
          expires_at?: string
          id?: string
          name: string
          redeemed_at?: string | null
          role?: string
          token?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string
          expires_at?: string
          id?: string
          name?: string
          redeemed_at?: string | null
          role?: string
          token?: string
        }
        Relationships: []
      }
      team_members: {
        Row: {
          aliases: string[]
          avatar_url: string | null
          created_at: string
          email: string
          id: string
          is_active: boolean
          name: string
          role: string
          slack_user_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          aliases?: string[]
          avatar_url?: string | null
          created_at?: string
          email: string
          id?: string
          is_active?: boolean
          name: string
          role: string
          slack_user_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          aliases?: string[]
          avatar_url?: string | null
          created_at?: string
          email?: string
          id?: string
          is_active?: boolean
          name?: string
          role?: string
          slack_user_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      tech_credit_allocations: {
        Row: {
          client_id: string | null
          cost_usd: number
          created_at: string
          credits: number
          date: string
          id: string
          note: string | null
          project_name: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          cost_usd?: number
          created_at?: string
          credits?: number
          date?: string
          id?: string
          note?: string | null
          project_name: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          cost_usd?: number
          created_at?: string
          credits?: number
          date?: string
          id?: string
          note?: string | null
          project_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tech_credit_allocations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      tech_external_projects: {
        Row: {
          client_id: string | null
          created_at: string
          id: string
          notes: string | null
          project_name: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          project_name: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          project_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tech_external_projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      tech_pricing: {
        Row: {
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          model: string | null
          notes: string | null
          rate_per_unit_usd: number
          service: string
          unit: string
        }
        Insert: {
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          model?: string | null
          notes?: string | null
          rate_per_unit_usd: number
          service: string
          unit: string
        }
        Update: {
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          model?: string | null
          notes?: string | null
          rate_per_unit_usd?: number
          service?: string
          unit?: string
        }
        Relationships: []
      }
      tech_usage_daily: {
        Row: {
          category: string
          client_id: string | null
          date: string
          event_count: number
          id: string
          service: string
          total_cache_read_tokens: number
          total_cache_write_tokens: number
          total_cost_usd: number
          total_input_tokens: number
          total_output_tokens: number
          total_quantity: number
          updated_at: string
        }
        Insert: {
          category: string
          client_id?: string | null
          date: string
          event_count?: number
          id?: string
          service: string
          total_cache_read_tokens?: number
          total_cache_write_tokens?: number
          total_cost_usd?: number
          total_input_tokens?: number
          total_output_tokens?: number
          total_quantity?: number
          updated_at?: string
        }
        Update: {
          category?: string
          client_id?: string | null
          date?: string
          event_count?: number
          id?: string
          service?: string
          total_cache_read_tokens?: number
          total_cache_write_tokens?: number
          total_cost_usd?: number
          total_input_tokens?: number
          total_output_tokens?: number
          total_quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tech_usage_daily_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      tech_usage_events: {
        Row: {
          cache_read_tokens: number | null
          cache_write_tokens: number | null
          category: string
          client_id: string | null
          cost_usd: number
          created_at: string
          id: string
          input_tokens: number | null
          metadata: Json | null
          model: string | null
          output_tokens: number | null
          quantity: number | null
          service: string
          surface: string | null
          unit: string
        }
        Insert: {
          cache_read_tokens?: number | null
          cache_write_tokens?: number | null
          category: string
          client_id?: string | null
          cost_usd?: number
          created_at?: string
          id?: string
          input_tokens?: number | null
          metadata?: Json | null
          model?: string | null
          output_tokens?: number | null
          quantity?: number | null
          service: string
          surface?: string | null
          unit?: string
        }
        Update: {
          cache_read_tokens?: number | null
          cache_write_tokens?: number | null
          category?: string
          client_id?: string | null
          cost_usd?: number
          created_at?: string
          id?: string
          input_tokens?: number | null
          metadata?: Json | null
          model?: string | null
          output_tokens?: number | null
          quantity?: number | null
          service?: string
          surface?: string | null
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "tech_usage_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
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
          meta_creative_id: string | null
          meta_image_hash: string | null
          meta_last_synced_at: string | null
          meta_push_error: string | null
          meta_pushed_at: string | null
          meta_pushed_by_id: string | null
          meta_video_id: string | null
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
          meta_creative_id?: string | null
          meta_image_hash?: string | null
          meta_last_synced_at?: string | null
          meta_push_error?: string | null
          meta_pushed_at?: string | null
          meta_pushed_by_id?: string | null
          meta_video_id?: string | null
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
          meta_creative_id?: string | null
          meta_image_hash?: string | null
          meta_last_synced_at?: string | null
          meta_push_error?: string | null
          meta_pushed_at?: string | null
          meta_pushed_by_id?: string | null
          meta_video_id?: string | null
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
            foreignKeyName: "trafficking_ads_meta_pushed_by_id_fkey"
            columns: ["meta_pushed_by_id"]
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
          billing_event: string | null
          client_id: string
          created_at: string
          created_by_id: string | null
          end_date: string | null
          id: string
          location: string | null
          meta_ad_account_id: string | null
          meta_adset_id: string | null
          meta_campaign_id: string | null
          meta_instagram_actor_id: string | null
          meta_page_id: string | null
          meta_pixel_id: string | null
          meta_push_error: string | null
          meta_pushed_at: string | null
          meta_pushed_by_id: string | null
          name: string
          objective: string | null
          optimization_goal: string | null
          platform: string
          start_date: string | null
          status: string
          targeting_spec: Json | null
          total_budget: number | null
          updated_at: string
        }
        Insert: {
          bidding_strategy?: string | null
          billing_event?: string | null
          client_id: string
          created_at?: string
          created_by_id?: string | null
          end_date?: string | null
          id?: string
          location?: string | null
          meta_ad_account_id?: string | null
          meta_adset_id?: string | null
          meta_campaign_id?: string | null
          meta_instagram_actor_id?: string | null
          meta_page_id?: string | null
          meta_pixel_id?: string | null
          meta_push_error?: string | null
          meta_pushed_at?: string | null
          meta_pushed_by_id?: string | null
          name: string
          objective?: string | null
          optimization_goal?: string | null
          platform: string
          start_date?: string | null
          status?: string
          targeting_spec?: Json | null
          total_budget?: number | null
          updated_at?: string
        }
        Update: {
          bidding_strategy?: string | null
          billing_event?: string | null
          client_id?: string
          created_at?: string
          created_by_id?: string | null
          end_date?: string | null
          id?: string
          location?: string | null
          meta_ad_account_id?: string | null
          meta_adset_id?: string | null
          meta_campaign_id?: string | null
          meta_instagram_actor_id?: string | null
          meta_page_id?: string | null
          meta_pixel_id?: string | null
          meta_push_error?: string | null
          meta_pushed_at?: string | null
          meta_pushed_by_id?: string | null
          name?: string
          objective?: string | null
          optimization_goal?: string | null
          platform?: string
          start_date?: string | null
          status?: string
          targeting_spec?: Json | null
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
          {
            foreignKeyName: "trafficking_campaigns_meta_pushed_by_id_fkey"
            columns: ["meta_pushed_by_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      universal_ads_geo_metrics: {
        Row: {
          campaign_name: string | null
          clicks: number
          client_id: string
          created_at: string
          creative_name: string | null
          date: string
          entity: string
          entity_name: string
          id: string
          impressions: number
          raw: Json | null
          spend: number
          updated_at: string
        }
        Insert: {
          campaign_name?: string | null
          clicks?: number
          client_id: string
          created_at?: string
          creative_name?: string | null
          date: string
          entity: string
          entity_name?: string
          id?: string
          impressions?: number
          raw?: Json | null
          spend?: number
          updated_at?: string
        }
        Update: {
          campaign_name?: string | null
          clicks?: number
          client_id?: string
          created_at?: string
          creative_name?: string | null
          date?: string
          entity?: string
          entity_name?: string
          id?: string
          impressions?: number
          raw?: Json | null
          spend?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "universal_ads_geo_metrics_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      universal_ads_report_jobs: {
        Row: {
          client_id: string
          created_at: string
          dimension: string
          end_date: string
          id: string
          last_error: string | null
          rows_written: number
          scheduled_report_id: string
          start_date: string
          status: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          dimension: string
          end_date: string
          id?: string
          last_error?: string | null
          rows_written?: number
          scheduled_report_id: string
          start_date: string
          status?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          dimension?: string
          end_date?: string
          id?: string
          last_error?: string | null
          rows_written?: number
          scheduled_report_id?: string
          start_date?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "universal_ads_report_jobs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      slack_unanswered_client_questions: {
        Row: {
          age_working_hours: number | null
          asked_at: string | null
          author: string | null
          channel_id: string | null
          channel_name: string | null
          client_id: string | null
          client_name: string | null
          id: string | null
          permalink: string | null
          question: string | null
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
    }
    Functions: {
      compute_tech_cost: {
        Args: {
          p_cache_read_tokens?: number
          p_cache_write_tokens?: number
          p_input_tokens?: number
          p_model: string
          p_output_tokens?: number
          p_quantity?: number
          p_service: string
          p_unit: string
        }
        Returns: number
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      find_similar_open_tasks: {
        Args: {
          p_client_id: string
          p_limit?: number
          p_text: string
          p_threshold?: number
        }
        Returns: {
          assignee_id: string
          id: string
          similarity: number
          status: string
          title: string
        }[]
      }
      find_similar_pending_candidates: {
        Args: {
          p_client_id: string
          p_exclude_id: string
          p_limit?: number
          p_text: string
          p_threshold?: number
        }
        Returns: {
          confidence: number
          id: string
          proposed_title: string
          sim: number
        }[]
      }
      get_team_member_id: { Args: { check_user_id: string }; Returns: string }
      has_client_access: {
        Args: { check_client_id: string; check_user_id: string }
        Returns: boolean
      }
      integrity_daily_call_feed: {
        Args: { p_client_id: string; p_since: string; p_table: string }
        Returns: {
          calls: number
          converted: number
          d: string
          payout: number
          revenue: number
        }[]
      }
      integrity_daily_spend_feed: {
        Args: {
          p_client_id: string
          p_platforms: string[]
          p_since: string
          p_table: string
        }
        Returns: {
          d: string
          spend: number
        }[]
      }
      is_account_manager: { Args: { check_user_id: string }; Returns: boolean }
      is_admin: { Args: { check_user_id: string }; Returns: boolean }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      ringfuel_merge_call: {
        Args: { p_event?: string; p_row: Json }
        Returns: Json
      }
      working_hours_between: {
        Args: { p_end: string; p_start: string }
        Returns: number
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
