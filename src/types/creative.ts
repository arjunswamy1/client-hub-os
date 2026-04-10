
export interface SizePreset {
  label: string;
  width: number;
  height: number;
}

export const SIZE_PRESETS: SizePreset[] = [
  // Social
  { label: 'Feed Square', width: 1080, height: 1080 },
  { label: 'Feed Portrait', width: 1080, height: 1350 },
  { label: 'Story/Reel', width: 1080, height: 1920 },
  { label: 'Landscape', width: 1200, height: 628 },
  { label: 'YouTube Thumbnail', width: 1280, height: 720 },
  // Display Banners
  { label: 'Leaderboard', width: 728, height: 90 },
  { label: 'Medium Rectangle', width: 300, height: 250 },
  { label: 'Wide Skyscraper', width: 160, height: 600 },
  { label: 'Half Page', width: 300, height: 600 },
  { label: 'Large Rectangle', width: 336, height: 280 },
  { label: 'Billboard', width: 970, height: 250 },
  { label: 'Mobile Banner', width: 320, height: 50 },
  { label: 'Large Mobile Banner', width: 320, height: 100 },
  // OTT / CTV
  { label: 'CTV 16:9 (1920×1080)', width: 1920, height: 1080 },
  { label: 'CTV 16:9 (3840×2160)', width: 3840, height: 2160 },
  { label: 'CTV Companion (300×250)', width: 300, height: 250 },
  { label: 'CTV Companion (728×90)', width: 728, height: 90 },
];

export const CREATIVE_TYPES = [
  { value: 'static', label: 'Static Image' },
  { value: 'video', label: 'Video' },
  { value: 'motion', label: 'Motion/Animation' },
  { value: 'carousel', label: 'Carousel' },
  { value: 'story_reel', label: 'Story/Reel' },
  { value: 'ugc', label: 'UGC-style' },
  { value: 'display_banner', label: 'Display Banner' },
  { value: 'ott_ctv', label: 'OTT / CTV' },
  { value: 'other', label: 'Other' },
];

export const PLATFORMS = [
  { value: 'meta', label: 'Meta' },
  { value: 'google_display', label: 'Google (Display)' },
  { value: 'google_youtube', label: 'Google (YouTube)' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'ott_ctv', label: 'OTT / CTV' },
  { value: 'email', label: 'Email' },
  { value: 'landing_page', label: 'Landing Page' },
  { value: 'other', label: 'Other' },
];

export const FUNNEL_STAGES = [
  { value: 'tof', label: 'TOF (Prospecting)' },
  { value: 'mof', label: 'MOF (Retargeting)' },
  { value: 'bof', label: 'BOF (Conversion)' },
  { value: 'retention', label: 'Retention' },
  { value: 'brand', label: 'Brand' },
];

export const BRIEF_STATUSES = [
  'draft', 'submitted', 'in_design', 'ready_for_review',
  'revision_requested', 'approved', 'delivered',
] as const;

export type BriefStatus = typeof BRIEF_STATUSES[number];

export const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'bg-muted text-muted-foreground' },
  submitted: { label: 'Submitted', color: 'bg-blue-100 text-blue-700' },
  in_design: { label: 'In Design', color: 'bg-yellow-100 text-yellow-700' },
  ready_for_review: { label: 'Ready for Review', color: 'bg-purple-100 text-purple-700' },
  revision_requested: { label: 'Revision Requested', color: 'bg-orange-100 text-orange-700' },
  approved: { label: 'Approved', color: 'bg-green-100 text-green-700' },
  delivered: { label: 'Delivered', color: 'bg-green-200 text-green-800' },
};

export const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  urgent: { label: 'Urgent', color: 'bg-red-100 text-red-700' },
  high: { label: 'High', color: 'bg-orange-100 text-orange-700' },
  medium: { label: 'Medium', color: 'bg-blue-100 text-blue-700' },
  low: { label: 'Low', color: 'bg-muted text-muted-foreground' },
};
