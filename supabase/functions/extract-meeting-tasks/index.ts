// Turns the "### Next Steps" lines of Wispr meeting summaries into task CANDIDATES.
//
// Nothing here writes to `tasks`. Every line becomes a `task_candidates` row and then
// passes the three gates in _shared/task-gate.ts; only a candidate that clears all of
// them, with a resolved CPM owner, is promoted into a real task. Everything else waits
// in the hub review queue.
//
// Owner resolution is EXACT, never fuzzy: a name matches a team member only by
// `name`, an entry of `aliases`, or the local part of `email`, case-insensitively.
// "AJ Swamy" -> "Arjun Swamy" shares no token, so any prefix/distance heuristic
// would either miss it or assign it to the wrong person — and a task on the wrong
// person's board is worse than an unassigned one.
//
// Three owner kinds, three behaviours:
//   CPM (matched team member) -> may auto-promote if the gates pass
//   `Speaker N` (diarization failed) -> always queued, needs_owner
//   anyone else (client/vendor) -> owner_side 'client', never auto-promoted
//
// Dedupe is on (meeting_id, normalised action text) stored as dedupe_key, backed by a
// unique index, so re-running can never double-propose.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { gateCandidates, type CandidateRow } from '../_shared/task-gate.ts';


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-nonce',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const TITLE_MAX = 120;
/** Items from a meeting older than this open in backlog, not todo. */
const FRESH_DAYS = 7;
const SPEAKER_RE = /^Speaker \d+$/i;

interface TeamRow { id: string; name: string; email: string; aliases: string[] | null; is_active: boolean }

/** Every exact key an active team member can be addressed by, lowercased. */
function ownerIndex(rows: TeamRow[]): Map<string, string> {
  const idx = new Map<string, string>();
  for (const r of rows) {
    if (!r.is_active) continue;
    const keys = [r.name, ...(r.aliases ?? []), (r.email ?? '').split('@')[0]];
    for (const k of keys) {
      const key = (k ?? '').trim().toLowerCase();
      if (key) idx.set(key, r.id);
    }
  }
  return idx;
}

/** The Next Steps block only — it ends at the next markdown heading. */
export function nextStepsSection(content: string | null): string {
  if (!content) return '';
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{2,4}\s*Next Steps\b/i.test(l.trim()));
  if (start === -1) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^#{1,6}\s/.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

export interface ParsedStep { ownerRaw: string; action: string }

export function parseSteps(content: string | null): ParsedStep[] {
  const out: ParsedStep[] = [];
  for (const raw of nextStepsSection(content).split(/\r?\n/)) {
    const m = /^\s*[-*]\s*\(([^)]+)\)\s*(.+?)\s*$/.exec(raw);
    if (!m) continue;
    const ownerRaw = m[1].trim();
    const action = m[2].trim();
    if (!ownerRaw || !action) continue;
    out.push({ ownerRaw, action });
  }
  return out;
}

/** lowercase, collapse whitespace, strip trailing punctuation. */
export function normaliseAction(action: string): string {
  return action.toLowerCase().replace(/\s+/g, ' ').replace(/[.,;:!?\s]+$/g, '').trim();
}

export function truncateTitle(action: string): string {
  if (action.length <= TITLE_MAX) return action;
  const cut = action.slice(0, TITLE_MAX);
  const space = cut.lastIndexOf(' ');
  return `${(space > 60 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const bearer = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim();
  const nonce = req.headers.get('x-cron-nonce') || '';

  let authorized = bearer !== '' && bearer === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!authorized && /^[0-9a-f-]{36}$/i.test(nonce)) {
    const { data: tokenRow } = await supabase
      .from('cron_invocation_tokens')
      .delete()
      .eq('token', nonce)
      .gt('created_at', new Date(Date.now() - 5 * 60000).toISOString())
      .select('token')
      .maybeSingle();
    authorized = !!tokenRow;
  }
  if (!authorized && bearer) {
    const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    });
    const { data: auth } = await asUser.auth.getUser();
    authorized = !!auth?.user;
  }
  if (!authorized) return json({ error: 'Unauthorized' }, 401);

  try {
    const [{ data: members, error: memberErr }, { data: meetings, error: meetingErr }] = await Promise.all([
      supabase.from('team_members').select('id, name, email, aliases, is_active'),
      supabase
        .from('context_items')
        .select('id, client_id, title, content, occurred_at, metadata')
        .eq('source', 'wispr')
        .order('occurred_at', { ascending: true }),
    ]);
    if (memberErr) throw memberErr;
    if (meetingErr) throw meetingErr;

    const idx = ownerIndex((members ?? []) as TeamRow[]);

    // Dedupe keys already seen — as a candidate, or as a task created before the
    // gate existed. Either way the line must not be proposed again.
    const existing = new Set<string>();
    for (const table of ['task_candidates', 'tasks'] as const) {
      for (let from = 0; ; from += 1000) {
        const q = table === 'task_candidates'
          ? supabase.from('task_candidates').select('dedupe_key').eq('source', 'wispr').range(from, from + 999)
          : supabase.from('tasks').select('type_data').eq('type_data->>source', 'wispr').range(from, from + 999);
        const { data, error } = await q;
        if (error) throw error;
        for (const row of data ?? []) {
          const k = table === 'task_candidates'
            ? (row as { dedupe_key?: string | null }).dedupe_key
            : (row as { type_data?: Record<string, unknown> }).type_data?.dedupe_key;
          if (typeof k === 'string') existing.add(k);
        }
        if (!data || data.length < 1000) break;
      }
    }

    const rows: Record<string, unknown>[] = [];
    const unmatchedOwners = new Map<string, number>();
    const seenThisRun = new Set<string>();
    let parsed = 0;

    for (const meeting of meetings ?? []) {
      const m = meeting as {
        id: string; client_id: string | null; title: string | null;
        content: string | null; occurred_at: string; metadata: Record<string, unknown> | null;
      };
      const shareLink = typeof m.metadata?.share_link === 'string' ? m.metadata.share_link : null;

      for (const step of parseSteps(m.content)) {
        parsed++;
        const dedupeKey = `${m.id}:${normaliseAction(step.action)}`;
        if (existing.has(dedupeKey) || seenThisRun.has(dedupeKey)) continue;
        seenThisRun.add(dedupeKey);

        const isSpeaker = SPEAKER_RE.test(step.ownerRaw);
        const assigneeId = isSpeaker ? null : idx.get(step.ownerRaw.toLowerCase()) ?? null;
        const ownerSide = assigneeId ? 'cpm' : isSpeaker ? 'unknown' : 'client';
        if (!assigneeId && !isSpeaker) {
          unmatchedOwners.set(step.ownerRaw, (unmatchedOwners.get(step.ownerRaw) ?? 0) + 1);
        }

        rows.push({
          client_id: m.client_id,
          source: 'wispr',
          source_ref: {
            meeting_id: m.id,
            share_link: shareLink,
            meeting_title: m.title,
            meeting_date: m.occurred_at,
          },
          raw_text: step.action,
          proposed_title: truncateTitle(step.action),
          proposed_assignee_id: assigneeId,
          owner_raw: step.ownerRaw,
          owner_side: ownerSide,
          status: 'pending',
          dedupe_key: dedupeKey,
        });
      }
    }

    // Candidates only — nothing here writes to `tasks`. Promotion is the gate's job.
    const inserted: CandidateRow[] = [];
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const { data, error } = await supabase.from('task_candidates').insert(chunk)
        .select('id, client_id, source, source_ref, raw_text, proposed_title, proposed_assignee_id, owner_raw, owner_side, status, created_at');
      if (error) throw error;
      inserted.push(...((data ?? []) as CandidateRow[]));
    }

    const gate = await gateCandidates(supabase, inserted, Deno.env.get('LOVABLE_API_KEY') ?? '');

    const summary = {
      meetings: (meetings ?? []).length,
      lines_parsed: parsed,
      candidates_created: inserted.length,
      assigned_cpm: rows.filter((r) => r.owner_side === 'cpm').length,
      unassigned_unknown_speaker: rows.filter((r) => r.owner_side === 'unknown').length,
      client_side: rows.filter((r) => r.owner_side === 'client').length,
      gate: gate.summary,
      unmatched_owners: Object.fromEntries(unmatchedOwners),
    };
    console.log('extract-meeting-tasks:', JSON.stringify(summary));
    return json({ success: true, ...summary });

  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('extract-meeting-tasks FAILED:', message);
    return json({ error: message }, 500);
  }
});
