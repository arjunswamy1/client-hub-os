export type TaskType = 'general' | 'landing_page' | 'creative_brief' | 'media_build';

export const TASK_TYPE_CONFIG: Record<TaskType, { label: string; emoji: string; description: string }> = {
  general: { label: 'General', emoji: '📝', description: 'A standard task.' },
  landing_page: { label: 'Landing Page', emoji: '🌐', description: 'Page build, with tracking + must-haves.' },
  creative_brief: { label: 'Creative Brief', emoji: '🎨', description: 'Opens a draft brief in Creative Production.' },
  media_build: { label: 'Media Build', emoji: '📊', description: 'Platform + vertical campaign build.' },
};

export interface LandingPageTypeData {
  landing_page_url?: string;
  tracking_confirmed?: boolean;
  tracking_notes?: string;
  must_haves?: string;
  is_ab_test?: boolean;
  variants?: { label: string; url: string; notes?: string }[];
}

export interface CreativeBriefTypeData {
  briefs_needed?: string;
  num_ads?: number;
  deadline?: string;
  formats?: string;
  notes?: string;
}

export interface MediaBuildTypeData {
  platform?: string; // Google, Meta, Bing, TikTok, etc.
  vertical?: string;
  campaign_objective?: string;
  budget?: string;
  notes?: string;
}

export const PLATFORM_OPTIONS = ['Google Ads', 'Meta Ads', 'Bing Ads', 'TikTok Ads', 'YouTube', 'Other'];
