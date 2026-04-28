export type ExperienceLevel = 'professional' | 'comedy_improv' | 'content_creator' | 'natural';
export type ActorStatus = 'new' | 'reviewed' | 'approved' | 'active' | 'inactive';
export type ShootStatus =
  | 'draft' | 'submitted' | 'scripts_approved' | 'actors_cast' | 'location_confirmed'
  | 'scheduled' | 'in_production' | 'footage_uploaded' | 'in_post_production'
  | 'delivered' | 'archived' | 'canceled';
export type ShootPriority = 'urgent' | 'high' | 'medium' | 'low';
export type CastStatus = 'invited' | 'interested' | 'confirmed' | 'declined' | 'no_show';
export type ClipType = 'scripted_take' | 'broll' | 'blooper' | 'other';
export type LocationStatus = 'active' | 'unavailable' | 'needs_rescouting';

export interface TalentActor {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  instagram_handle: string | null;
  city: string;
  headshot_url: string | null;
  additional_photos: { url: string; description?: string }[];
  demo_reel_url: string | null;
  experience_level: ExperienceLevel | null;
  specialties: string[];
  languages: string[];
  age_range_appearance: string | null;
  gender: string | null;
  weekly_availability: Record<string, string[]>;
  has_transportation: boolean;
  travel_radius_miles: number | null;
  bio: string | null;
  source: string | null;
  status: ActorStatus;
  producer_rating: number | null;
  producer_notes: string | null;
  total_shoots: number;
  last_shoot_date: string | null;
  hourly_rate: number | null;
  created_at: string;
  updated_at: string;
}

export interface ShootLocation {
  id: string;
  name: string;
  address: string | null;
  city: string;
  latitude: number | null;
  longitude: number | null;
  location_type: string | null;
  good_for_verticals: string[];
  cost_type: 'free' | 'hourly' | 'daily' | 'flat' | null;
  cost_amount: number;
  photos: { url: string; description?: string }[];
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  availability_notes: string | null;
  producer_notes: string | null;
  status: LocationStatus;
  last_used_date: string | null;
  created_by_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShootScript {
  id: string;
  brief_id: string;
  title: string;
  full_script: string;
  hook_line: string | null;
  cta_line: string | null;
  key_phrases: string[];
  tone_direction: string | null;
  duration_estimate_seconds: number | null;
  client_ids: string[];
  verticals: string[];
  position: number;
  created_at: string;
}

export interface ShootCast {
  id: string;
  brief_id: string;
  actor_id: string;
  role_description: string | null;
  status: CastStatus;
  hourly_rate: number | null;
  estimated_hours: number | null;
  actual_hours: number | null;
  total_payment: number | null;
  payment_status: 'pending' | 'paid';
  is_first_shoot: boolean;
  producer_rating_for_shoot: number | null;
  producer_notes_for_shoot: string | null;
  confirmed_at: string | null;
  created_at: string;
  actor?: TalentActor;
}

export interface ShootFootage {
  id: string;
  brief_id: string;
  script_id: string | null;
  file_url: string;
  drive_file_id: string | null;
  drive_url: string | null;
  file_name: string | null;
  file_type: string | null;
  file_size_bytes: number | null;
  duration_seconds: number | null;
  thumbnail_url: string | null;
  clip_type: ClipType | null;
  take_number: number | null;
  is_best_take: boolean;
  is_usable: boolean;
  producer_notes: string | null;
  uploaded_by_id: string | null;
  uploaded_at: string;
}

export interface BRollItem {
  description: string;
  purpose?: string;
  duration_estimate?: number;
  reference_url?: string;
}

export interface ShootBrief {
  id: string;
  title: string;
  client_ids: string[];
  verticals: string[];
  priority: ShootPriority;
  shoot_deadline: string | null;
  content_deadline: string | null;
  assigned_producer_id: string | null;
  shoot_types: string[];
  num_scripts: number;
  target_script_length: string | null;
  takes_per_script: number;
  platforms: string[];
  orientations: string[];
  branding: 'unbranded' | 'branded';
  num_actors: number;
  gender_preference: string | null;
  age_range: string | null;
  specialties_needed: string[];
  new_actor_ok: boolean;
  location_id: string | null;
  location_type: string | null;
  location_notes: string | null;
  location_confirmed: boolean;
  location_cost: number;
  camera_setup: string | null;
  audio_setup: string | null;
  lighting_notes: string | null;
  support_crew_notes: string | null;
  broll_shot_list: BRollItem[];
  estimated_actor_cost: number | null;
  estimated_location_cost: number | null;
  estimated_crew_cost: number | null;
  estimated_equipment_cost: number | null;
  estimated_travel_cost: number | null;
  estimated_total: number | null;
  actual_total: number | null;
  status: ShootStatus;
  shoot_date: string | null;
  shoot_start_time: string | null;
  shoot_end_time: string | null;
  estimated_shoot_hours: number | null;
  drive_footage_folder_url: string | null;
  linked_creative_brief_id: string | null;
  created_by_id: string | null;
  created_at: string;
  updated_at: string;
}

export const SPECIALTY_OPTIONS = [
  { value: 'comedy', label: 'Comedy / Improv' },
  { value: 'dramatic', label: 'Dramatic' },
  { value: 'voiceover', label: 'Voice-Over' },
  { value: 'ugc', label: 'UGC-Style' },
  { value: 'spokesperson', label: 'Spokesperson' },
  { value: 'street_interview', label: 'Street Interview' },
  { value: 'bilingual', label: 'Bilingual' },
];

export const SHOOT_TYPE_OPTIONS = [
  { value: 'talking_head_blue_screen', label: 'Talking Head (Blue Screen)' },
  { value: 'talking_head_location', label: 'Talking Head (On Location)' },
  { value: 'ugc', label: 'UGC-Style' },
  { value: 'street_interview', label: 'Street Interview' },
  { value: 'two_person', label: 'Two-Person Conversation' },
  { value: 'product_demo', label: 'Product Demo' },
  { value: 'testimonial', label: 'Testimonial' },
  { value: 'broll_only', label: 'B-Roll Only' },
];

export const PLATFORM_OPTIONS = [
  { value: 'meta', label: 'Meta' },
  { value: 'google_youtube', label: 'Google / YouTube' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'ctv', label: 'CTV' },
];

export const ORIENTATION_OPTIONS = [
  { value: 'vertical_9_16', label: 'Vertical (9:16)' },
  { value: 'horizontal_16_9', label: 'Horizontal (16:9)' },
  { value: 'square_1_1', label: 'Square (1:1)' },
];

export const AGE_RANGE_OPTIONS = ['18-25', '25-35', '35-45', '45-55', '55+'];

export const VERTICAL_OPTIONS = [
  'HVAC', 'Bathroom Remodel', 'Roofing', 'Plumbing', 'Insurance',
  'Solar', 'Windows', 'Flooring', 'Pest Control', 'Flights', 'Other',
];

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export const TIME_SLOTS = ['morning', 'afternoon', 'evening'] as const;

export const STATUS_LABEL: Record<ShootStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  scripts_approved: 'Scripts Approved',
  actors_cast: 'Actors Cast',
  location_confirmed: 'Location Confirmed',
  scheduled: 'Scheduled',
  in_production: 'In Production',
  footage_uploaded: 'Footage Uploaded',
  in_post_production: 'In Post-Production',
  delivered: 'Delivered',
  archived: 'Archived',
  canceled: 'Canceled',
};

export const STATUS_COLOR: Record<ShootStatus, string> = {
  draft: 'bg-slate-100 text-slate-700 border-slate-200',
  submitted: 'bg-blue-50 text-blue-700 border-blue-200',
  scripts_approved: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  actors_cast: 'bg-violet-50 text-violet-700 border-violet-200',
  location_confirmed: 'bg-purple-50 text-purple-700 border-purple-200',
  scheduled: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  in_production: 'bg-amber-50 text-amber-700 border-amber-200',
  footage_uploaded: 'bg-orange-50 text-orange-700 border-orange-200',
  in_post_production: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  delivered: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  archived: 'bg-slate-100 text-slate-500 border-slate-200',
  canceled: 'bg-rose-50 text-rose-700 border-rose-200',
};
