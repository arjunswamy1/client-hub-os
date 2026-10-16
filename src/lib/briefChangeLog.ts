import { STATUS_CONFIG } from '@/types/creative';

export interface BriefChange {
  id: string; field: string; old_value: string | null; new_value: string | null;
  actor_kind: 'user' | 'bot' | 'system'; via: string; created_at: string;
  changed_by?: { name: string | null } | null;
}

const FIELD_LABELS: Record<string, string> = {
  status: 'Status', assigned_to_id: 'Assignee', due_date: 'Due date', scheduled_date: 'Scheduled date', priority: 'Priority',
  title: 'Title', objective: 'Objective', target_audience: 'Target audience', key_message: 'Key message', notes: 'Notes',
  tone_style: 'Tone', dos_and_donts: "Do's and don'ts", copy_suggestions: 'Copy suggestions', creative_type: 'Creative type',
  creative_types: 'Creative types', platforms: 'Platforms', sizes: 'Sizes', num_concepts: 'Concepts', funnel_stage: 'Funnel stage',
  video_scripts: 'Video scripts', brand_guidelines_url: 'Brand guidelines link', reference_assets: 'Reference links',
  raw_footage_url: 'Raw footage link', final_assets_url: 'Final assets link', drive_wip_folder_id: 'Drive WIP folder',
  drive_approved_folder_id: 'Drive approved folder', deleted_at: 'Deleted', comment_added: 'Comment added',
  comment_edited: 'Comment edited', comment_deleted: 'Comment deleted',
};

export const fieldLabel = (f: string) => FIELD_LABELS[f] ?? f.replace(/_/g, ' ');

/** Newest first. */
export const sortChangesNewestFirst = (rows: BriefChange[]) => [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));

export function formatChangeValue(field: string, v: string | null, memberName: (id: string) => string | undefined): string {
  if (v === null || v === '') return '—';
  if (field === 'status') return STATUS_CONFIG[v]?.label ?? v;
  if (field === 'assigned_to_id') return memberName(v) ?? 'Unknown person';
  return v.length > 200 ? `${v.slice(0, 200)}…` : v;
}

export function actorLabel(c: BriefChange): string {
  const name = c.changed_by?.name;
  if (c.actor_kind === 'bot') return `${name ?? 'Bot'} (bot)`;
  if (c.actor_kind === 'system') return 'System';
  return name ?? 'Unknown user';
}
