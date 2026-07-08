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
          caller_city: string | null
          caller_number: string | null
          caller_state: string | null
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
          raw_payload: Json | null
          recording_url: string | null
        }
        Insert: {
          call_id: string
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
          did?: string | null
          disposition?: string | null
          duration_seconds?: number | null
          id?: string
          payout?: number | null
          raw_payload?: Json | null
          recording_url?: string | null
        }
        Update: {
          call_id?: string
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
          did?: string | null
          disposition?: string | null
          duration_seconds?: number | null
          id?: string
          payout?: number | null
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
          deleted_at: string | null
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
          deleted_at?: string | null
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
          deleted_at?: string | null
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
          client_id: string
          created_at: string
          id: string
          last_synced_ts: string | null
          sync_enabled: boolean
          updated_at: string
        }
        Insert: {
          channel_id: string
          channel_name: string
          client_id: string
          created_at?: string
          id?: string
          last_synced_ts?: string | null
          sync_enabled?: boolean
          updated_at?: string
        }
        Update: {
          channel_id?: string
          channel_name?: string
          client_id?: string
          created_at?: string
          id?: string
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
          task_type: string
          title: string
          type_data: Json
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
          task_type?: string
          title: string
          type_data?: Json
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
    }
    Views: {
      [_ in never]: never
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
      get_team_member_id: { Args: { check_user_id: string }; Returns: string }
      has_client_access: {
        Args: { check_client_id: string; check_user_id: string }
        Returns: boolean
      }
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
