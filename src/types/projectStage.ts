// Unified 5-tier project stage vocabulary.
// Both shoot_briefs and creative_briefs map to one of these stages so the UI
// can render a consistent pipeline view across the production module.
//
// Color tokens use semantic tailwind classes (no raw colors) so dark mode + theming work.

import type { ShootStatus } from './production';

export type ProjectStage = 'planning' | 'scheduled' | 'in_production' | 'in_post' | 'delivered' | 'canceled';

export const STAGE_LABEL: Record<ProjectStage, string> = {
  planning: 'Planning',
  scheduled: 'Scheduled',
  in_production: 'In Production',
  in_post: 'In Post',
  delivered: 'Delivered',
  canceled: 'Canceled',
};

// Semantic class names — no raw color values. These respect the design system tokens.
export const STAGE_CLASSES: Record<ProjectStage, { badge: string; dot: string; ring: string }> = {
  planning:      { badge: 'bg-muted text-muted-foreground border-border',                dot: 'bg-muted-foreground',  ring: 'ring-muted' },
  scheduled:     { badge: 'bg-primary/10 text-primary border-primary/20',                dot: 'bg-primary',           ring: 'ring-primary/30' },
  in_production: { badge: 'bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-400', dot: 'bg-amber-500', ring: 'ring-amber-500/30' },
  in_post:       { badge: 'bg-violet-500/10 text-violet-700 border-violet-500/20 dark:text-violet-400', dot: 'bg-violet-500', ring: 'ring-violet-500/30' },
  delivered:     { badge: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-400', dot: 'bg-emerald-500', ring: 'ring-emerald-500/30' },
  canceled:      { badge: 'bg-destructive/10 text-destructive border-destructive/20',   dot: 'bg-destructive',       ring: 'ring-destructive/30' },
};

export const STAGE_ORDER: ProjectStage[] = ['planning', 'scheduled', 'in_production', 'in_post', 'delivered'];

// ----- Shoot brief mapping (12 statuses → 5 stages) -----
export function shootStageOf(status: ShootStatus): ProjectStage {
  switch (status) {
    case 'draft':
    case 'submitted':
    case 'scripts_approved':
    case 'actors_cast':
    case 'location_confirmed':
      return 'planning';
    case 'scheduled':
      return 'scheduled';
    case 'in_production':
    case 'footage_uploaded':
      return 'in_production';
    case 'in_post_production':
      return 'in_post';
    case 'delivered':
    case 'archived':
      return 'delivered';
    case 'canceled':
      return 'canceled';
  }
}

// ----- Creative brief mapping (7 statuses → 5 stages) -----
export function creativeStageOf(status: string): ProjectStage {
  switch (status) {
    case 'draft':
    case 'submitted':
      return 'planning';
    case 'in_design':
    case 'ready_for_review':
    case 'revision_requested':
      return 'in_post'; // creative work is the "post" phase of any project
    case 'approved':
    case 'delivered':
      return 'delivered';
    default:
      return 'planning';
  }
}

// ----- Valid forward transitions for shoot briefs (used by the status dropdown) -----
// The dropdown previously offered all 12 statuses regardless of position. Now we only
// surface meaningful next steps. Admins/AMs can still go backward via "skip back" options.
const FORWARD_MAP: Record<ShootStatus, ShootStatus[]> = {
  draft:               ['submitted', 'canceled'],
  submitted:           ['scripts_approved', 'draft', 'canceled'],
  scripts_approved:    ['actors_cast', 'submitted', 'canceled'],
  actors_cast:         ['location_confirmed', 'scripts_approved', 'canceled'],
  location_confirmed:  ['scheduled', 'actors_cast', 'canceled'],
  scheduled:           ['in_production', 'location_confirmed', 'canceled'],
  in_production:       ['footage_uploaded', 'canceled'],
  footage_uploaded:    ['in_post_production', 'in_production'],
  in_post_production:  ['delivered', 'footage_uploaded'],
  delivered:           ['archived', 'in_post_production'],
  archived:            ['delivered'],
  canceled:            ['draft'],
};

export function validShootTransitions(role: string | undefined, current: ShootStatus): ShootStatus[] {
  if (role === 'designer') {
    // Designers can only mark delivered when in post-production
    return current === 'in_post_production' ? ['delivered'] : [];
  }
  // admin / account_manager / producer
  return FORWARD_MAP[current] || [];
}
