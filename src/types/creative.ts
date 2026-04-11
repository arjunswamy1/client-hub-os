
export interface SizePreset {
  label: string;
  width: number;
  height: number;
}

// Grouped size presets by category
export const SIZE_GROUPS: { category: string; platforms: string[]; sizes: SizePreset[] }[] = [
  {
    category: 'Social / Feed',
    platforms: ['meta', 'tiktok'],
    sizes: [
      { label: 'Feed Square', width: 1080, height: 1080 },
      { label: 'Feed Portrait', width: 1080, height: 1350 },
      { label: 'Story/Reel', width: 1080, height: 1920 },
      { label: 'Landscape', width: 1200, height: 628 },
    ],
  },
  {
    category: 'YouTube',
    platforms: ['google_youtube'],
    sizes: [
      { label: 'YouTube Thumbnail', width: 1280, height: 720 },
      { label: 'YouTube Video (1920×1080)', width: 1920, height: 1080 },
    ],
  },
  {
    category: 'Display Banners',
    platforms: ['google_display'],
    sizes: [
      { label: 'Leaderboard', width: 728, height: 90 },
      { label: 'Medium Rectangle', width: 300, height: 250 },
      { label: 'Wide Skyscraper', width: 160, height: 600 },
      { label: 'Half Page', width: 300, height: 600 },
      { label: 'Large Rectangle', width: 336, height: 280 },
      { label: 'Billboard', width: 970, height: 250 },
      { label: 'Mobile Banner', width: 320, height: 50 },
      { label: 'Large Mobile Banner', width: 320, height: 100 },
    ],
  },
  {
    category: 'OTT / CTV',
    platforms: ['ott_ctv'],
    sizes: [
      { label: 'CTV 16:9 (1920×1080)', width: 1920, height: 1080 },
      { label: 'CTV 16:9 4K (3840×2160)', width: 3840, height: 2160 },
      { label: 'CTV Companion (300×250)', width: 300, height: 250 },
      { label: 'CTV Companion (728×90)', width: 728, height: 90 },
    ],
  },
  {
    category: 'Programmatic / DSP',
    platforms: ['programmatic_dsp'],
    sizes: [
      { label: 'Medium Rectangle', width: 300, height: 250 },
      { label: 'Leaderboard', width: 728, height: 90 },
      { label: 'Wide Skyscraper', width: 160, height: 600 },
      { label: 'Half Page', width: 300, height: 600 },
      { label: 'Billboard', width: 970, height: 250 },
      { label: 'Large Leaderboard', width: 970, height: 90 },
      { label: 'Mobile Interstitial', width: 320, height: 480 },
      { label: 'Smartphone Banner', width: 320, height: 50 },
      { label: 'Tablet Banner', width: 768, height: 90 },
      { label: 'Native (1200×627)', width: 1200, height: 627 },
      { label: 'Native Square', width: 1200, height: 1200 },
      { label: 'Pre-Roll Video (1920×1080)', width: 1920, height: 1080 },
    ],
  },
  {
    category: 'Email & Landing Page',
    platforms: ['email', 'landing_page'],
    sizes: [
      { label: 'Email Header', width: 600, height: 200 },
      { label: 'Email Hero', width: 600, height: 400 },
      { label: 'Landing Page Hero', width: 1440, height: 600 },
    ],
  },
];

// Flat list of all presets (for backwards compat)
export const SIZE_PRESETS: SizePreset[] = SIZE_GROUPS.flatMap(g => g.sizes);

// Get relevant size groups based on selected platforms
export function getRelevantSizeGroups(selectedPlatforms: string[]): typeof SIZE_GROUPS {
  if (selectedPlatforms.length === 0) return SIZE_GROUPS;
  return SIZE_GROUPS.filter(g =>
    g.platforms.some(p => selectedPlatforms.includes(p)) ||
    selectedPlatforms.includes('other')
  );
}

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
  { value: 'programmatic_dsp', label: 'Programmatic / DSP' },
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
