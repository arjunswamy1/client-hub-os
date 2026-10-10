import { gateCandidates, normaliseText, type CandidateRow } from './task-gate.ts';

interface FathomItem {
  title: string;
  description: string;
  ownerRaw: string | null;
}

interface FathomSource {
  sourceId: string;
  meetingTitle: string;
  meetingDate: string;
  shareLink: string | null;
  accountLabel: string;
}

function memberKeys(member: any): string[] {
  return [member.name, ...(member.aliases ?? []), String(member.email ?? '').split('@')[0]]
    .map((value) => String(value ?? '').trim().toLowerCase())
    .filter(Boolean);
}

/** Fathom extractors propose candidates; only task-gate.ts may promote them to tasks. */
export async function proposeFathomCandidates(
  supabase: any,
  clientId: string,
  source: FathomSource,
  items: FathomItem[],
  apiKey: string,
): Promise<{ candidates_created: number; gate: unknown }> {
  if (items.length === 0) return { candidates_created: 0, gate: null };

  const { data: members, error: memberError } = await supabase
    .from('team_members').select('id, name, email, aliases, is_active').eq('is_active', true).eq('is_service_account', false);
  if (memberError) throw memberError;
  const owners = new Map<string, string>();
  for (const member of members ?? []) for (const key of memberKeys(member)) owners.set(key, member.id);

  const rows = items.filter((item) => item.title.trim()).map((item) => {
    const ownerKey = String(item.ownerRaw ?? '').trim().toLowerCase();
    const assigneeId = ownerKey ? owners.get(ownerKey) ?? null : null;
    return {
      client_id: clientId,
      source: 'fathom',
      source_ref: {
        meeting_id: source.sourceId,
        meeting_title: source.meetingTitle,
        meeting_date: source.meetingDate,
        share_link: source.shareLink,
        fathom_account: source.accountLabel,
      },
      raw_text: item.description,
      proposed_title: item.title.slice(0, 120),
      proposed_assignee_id: assigneeId,
      owner_raw: item.ownerRaw,
      owner_side: assigneeId ? 'cpm' : 'unknown',
      status: 'pending',
      dedupe_key: `fathom:${source.sourceId}:${normaliseText(item.description)}`,
    };
  });

  const keys = rows.map((row) => row.dedupe_key);
  const existing = new Set<string>();
  for (let i = 0; i < keys.length; i += 100) {
    const { data, error } = await supabase.from('task_candidates').select('dedupe_key').in('dedupe_key', keys.slice(i, i + 100));
    if (error) throw error;
    for (const row of data ?? []) if (row.dedupe_key) existing.add(row.dedupe_key);
  }
  const fresh = rows.filter((row) => !existing.has(row.dedupe_key));
  if (fresh.length === 0) return { candidates_created: 0, gate: null };

  const { data, error } = await supabase.from('task_candidates').insert(fresh)
    .select('id, client_id, source, source_ref, raw_text, proposed_title, proposed_assignee_id, owner_raw, owner_side, status, created_at, gate_results, confidence');
  if (error) throw error;
  const inserted = (data ?? []) as CandidateRow[];
  const gate = await gateCandidates(supabase, inserted, apiKey);
  return { candidates_created: inserted.length, gate: gate.summary };
}