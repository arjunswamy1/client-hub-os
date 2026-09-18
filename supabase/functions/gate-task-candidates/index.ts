// Runs the QA gate over task candidates.
//
// Actions:
//   run                    — gate every `pending` candidate (default; the scheduled job)
//   rescore_meeting_tasks  — score the already-created wispr tasks through Gates A and B
//                            as a calibration check. Writes type_data.gate_results and
//                            changes NOTHING else: no delete, no unassign, no status move.
//   backfill_archived_slack — replay the distinct titles of the archived Slack tasks as
//                            candidates so we can see what the gate would have allowed.
//                            The archived tasks themselves are never touched.
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  gateCandidates, runGateA, runGateB, decide,
  normaliseText, type CandidateRow,
} from '../_shared/task-gate.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-nonce',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const CANDIDATE_COLS =
  'id, client_id, source, source_ref, raw_text, proposed_title, proposed_assignee_id, owner_raw, owner_side, status, created_at, gate_results';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const apiKey = Deno.env.get('LOVABLE_API_KEY') ?? '';

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

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* cron sends {} */ }
  const action = String(body.action ?? 'run');

  try {
    if (action === 'run') {
      const { data, error } = await supabase
        .from('task_candidates').select(CANDIDATE_COLS)
        .eq('status', 'pending')
        .is('reviewed_at', null)
        .order('created_at', { ascending: true })
        .limit(Number(body.limit ?? 300));
      if (error) throw error;

      // Already-scored candidates waiting on a human are left alone — re-scoring them
      // every 15 minutes would burn model calls and could flip a human's queue item.
      const unscored = (data ?? []).filter(
        (c: any) => !c.gate_results || Object.keys(c.gate_results).length === 0,
      ) as CandidateRow[];

      const { summary } = await gateCandidates(supabase, unscored, apiKey);
      return json({ success: true, action, ...summary });
    }

    if (action === 'rescore_meeting_tasks') {
      const { data, error } = await supabase
        .from('tasks')
        .select('id, client_id, title, description, assignee_id, type_data')
        .eq('type_data->>source', 'wispr')
        .limit(500);
      if (error) throw error;

      const rows = (data ?? []) as any[];
      const asCandidates: CandidateRow[] = rows.map((t) => ({
        id: t.id,
        client_id: t.client_id,
        source: 'wispr',
        source_ref: t.type_data ?? {},
        raw_text: t.description ?? t.title,
        proposed_title: t.title,
        proposed_assignee_id: t.assignee_id,
        owner_raw: t.type_data?.owner_raw ?? null,
        owner_side: t.type_data?.owner_side ?? null,
        status: 'promoted',
      }));

      const a = await runGateA(asCandidates, apiKey);
      // Gate B against the other meeting tasks only — comparing a task to itself in
      // `tasks` would report every one as its own duplicate.
      const bySignature = new Map<string, string[]>();
      for (const c of asCandidates) {
        const k = `${c.client_id}:${normaliseText(c.proposed_title)}`;
        bySignature.set(k, [...(bySignature.get(k) ?? []), c.id]);
      }

      const queued: Record<string, unknown>[] = [];
      for (const c of asCandidates) {
        const ga = a.get(c.id)!;
        const dupGroup = bySignature.get(`${c.client_id}:${normaliseText(c.proposed_title)}`) ?? [];
        const b = {
          duplicate: dupGroup.length > 1 && dupGroup[0] !== c.id,
          duplicate_of_task_id: dupGroup.length > 1 ? dupGroup[0] : null,
          match_title: dupGroup.length > 1 ? c.proposed_title : null,
          similarity: dupGroup.length > 1 ? 1 : null,
          near_duplicate: dupGroup.length > 1,
          confirmed_by: 'exact' as const,
        };
        const gate = decide(c, ga, b, { appears_completed: false, evidence: null });

        const existing = rows.find((t) => t.id === c.id)?.type_data ?? {};
        await supabase.from('tasks')
          .update({ type_data: { ...existing, gate_results: { ...gate, rescored_at: new Date().toISOString() } } })
          .eq('id', c.id);

        if (!gate.auto_promote) {
          queued.push({
            task_id: c.id,
            title: c.proposed_title,
            owner_raw: c.owner_raw,
            owner_side: c.owner_side,
            blocked_by: gate.blocked_by,
            confidence: ga.confidence,
            reason: ga.is_task_reason,
          });
        }
      }

      return json({
        success: true, action,
        scored: asCandidates.length,
        would_auto_promote: asCandidates.length - queued.length,
        would_queue: queued.length,
        queued,
      });
    }

    if (action === 'backfill_archived_slack') {
      // Distinct titles only — the 907 archived rows stay exactly as they are.
      const seen = new Map<string, any>();
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from('tasks')
          .select('id, client_id, title, description, tags, type_data, created_at')
          .not('type_data->>archived_reason', 'is', null)
          .range(from, from + 999);
        if (error) throw error;
        for (const t of data ?? []) {
          const key = `${(t as any).client_id}:${normaliseText((t as any).title)}`;
          if (!seen.has(key)) seen.set(key, t);
        }
        if (!data || data.length < 1000) break;
      }

      const rows = [...seen.values()].map((t: any) => ({
        client_id: t.client_id,
        source: 'slack_client_request',
        source_ref: {
          replay_of_archived_task_id: t.id,
          tags: t.tags ?? [],
          archived_reason: t.type_data?.archived_reason ?? null,
          origin: 'phase3b_backfill',
        },
        raw_text: t.description ?? t.title,
        proposed_title: t.title,
        proposed_assignee_id: null,
        owner_raw: null,
        owner_side: 'unknown',
        status: 'pending',
        dedupe_key: `archived_replay:${t.client_id}:${normaliseText(t.title)}`,
      }));

      // The dedupe index is partial, so ON CONFLICT cannot target it — skip rows whose
      // key already exists instead, which is what a replay needs anyway. Keys are read
      // by prefix: a 200-key `in` list overflows the request URL.
      const existing = new Set<string>();
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from('task_candidates').select('dedupe_key')
          .like('dedupe_key', 'archived_replay:%')
          .range(from, from + 999);
        if (error) throw error;
        for (const r of data ?? []) existing.add((r as any).dedupe_key);
        if (!data || data.length < 1000) break;
      }
      const fresh = rows.filter((r) => !existing.has(r.dedupe_key));


      const inserted: CandidateRow[] = [];
      for (let i = 0; i < fresh.length; i += 200) {
        const { data, error } = await supabase.from('task_candidates')
          .insert(fresh.slice(i, i + 200))
          .select(CANDIDATE_COLS);
        if (error) throw error;
        inserted.push(...((data ?? []) as CandidateRow[]));
      }


      const { summary } = await gateCandidates(supabase, inserted, apiKey);
      return json({
        success: true, action,
        distinct_titles: rows.length,
        candidates_created: inserted.length,
        ...summary,
      });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    const message = e instanceof Error ? e.message : JSON.stringify(e);
    console.error('gate-task-candidates FAILED:', message);
    return json({ error: message }, 500);
  }
});
