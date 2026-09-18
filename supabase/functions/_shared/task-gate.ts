// The QA gate every proposed task must pass before it can become a real task.
//
// Nothing writes to `tasks` directly any more. Extractors write `task_candidates`;
// this module scores them and promotes only the ones that clear all three gates:
//
//   Gate A — is this actually a task? (model, strict rubric, done-state required)
//   Gate B — is it a duplicate of an open task or another pending candidate?
//   Gate C — does later context show it is already done?
//
// Bias throughout: when unsure, leave it `pending` for a human. A queued candidate
// costs someone ten seconds; a wrong auto-created task costs trust in the feature.

const GATEWAY = "https://ai.gateway.lovable.dev/v1/responses";
const MODEL = "openai/gpt-6-astra";

export const GATE_BATCH_SIZE = 15;
/** Trigram similarity at or above this is a *near* match — never a duplicate on its own. */
export const NEAR_DUPLICATE_THRESHOLD = 0.45;
/** Gate A confidence needed to auto-promote. Anything lower queues for review. */
export const AUTO_PROMOTE_CONFIDENCE = 0.8;

export interface CandidateRow {
  id: string;
  client_id: string | null;
  source: string;
  source_ref: Record<string, unknown> | null;
  raw_text: string;
  proposed_title: string;
  proposed_assignee_id: string | null;
  owner_raw: string | null;
  owner_side: string | null;
  status: string;
  created_at?: string;
  gate_results?: Record<string, unknown> | null;
}

export interface GateAResult {
  is_task: boolean;
  confidence: number;
  is_task_reason: string;
  decided_by: "llm" | "unavailable";
}

export interface GateOutcome {
  gate_a: GateAResult;
  gate_b: {
    duplicate: boolean;
    duplicate_of_task_id: string | null;
    match_title: string | null;
    similarity: number | null;
    near_duplicate: boolean;
    confirmed_by: "exact" | "llm" | "none";
  };
  gate_c: { appears_completed: boolean; evidence: string | null };
  auto_promote: boolean;
  blocked_by: string[];
}

/** lowercase, collapse whitespace, strip trailing punctuation. */
export function normaliseText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").replace(/[.,;:!?\s]+$/g, "").trim();
}

/** Dice coefficient over character trigrams — the cheap in-process stand-in for pg_trgm. */
export function trigramSimilarity(a: string, b: string): number {
  const grams = (s: string) => {
    const p = `  ${normaliseText(s)} `;
    const out = new Set<string>();
    for (let i = 0; i < p.length - 2; i++) out.add(p.slice(i, i + 3));
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let shared = 0;
  for (const g of ga) if (gb.has(g)) shared++;
  return (2 * shared) / (ga.size + gb.size);
}

function parseSse(raw: string): string {
  let out = "";
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const evt = JSON.parse(payload);
      if (evt.type === "response.output_text.delta" && typeof evt.delta === "string") out += evt.delta;
      else if (evt.type === "response.completed" && typeof evt.response?.output_text === "string" && out === "") {
        out = evt.response.output_text;
      }
    } catch { /* partial frame */ }
  }
  return out;
}

/** One streamed gateway call returning parsed json, or null on any failure. */
async function askModel(instructions: string, prompt: string, apiKey: string): Promise<any | null> {
  if (!apiKey) return null;
  try {
    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: MODEL,
        instructions,
        input: prompt,
        stream: true,
        reasoning: { effort: "low", summary: "auto" },
        text: { format: { type: "json_object" } },
      }),
    });
    if (!res.ok) {
      console.error("task-gate: gateway error", res.status, (await res.text()).slice(0, 400));
      return null;
    }
    const text = parseSse(await res.text());
    if (!text.trim()) {
      console.error("task-gate: empty model output");
      return null;
    }
    return JSON.parse(text.replace(/```json\s*/g, "").replace(/```/g, "").trim());
  } catch (e) {
    console.error("task-gate: model call failed —", e instanceof Error ? e.message : String(e));
    return null;
  }
}

// ──────────────────────────── Gate A ────────────────────────────

const GATE_A_SYSTEM = `You judge whether a line extracted from a meeting or a client message is a real task.
Return json only.

A line PASSES only if it describes a concrete action with a recognisable DONE-STATE — someone could
look at it next week and answer yes or no to "is this finished?".

A line FAILS if it is:
- a restatement of a discussion topic ("Discuss Q4 budget", "Timeshare campaign performance")
- an observation or a finding ("CPMs are climbing on the tubs angle")
- a status update ("Campaign is live", "Creative is with the client")
- already phrased as completed ("Paused the tubs campaign")
- too vague to ever be called finished ("Improve performance", "Keep an eye on things")

Judge by that rubric, NOT by spotting an imperative verb. Examples from real data:
- "Pause tubs and bathroom remodel on Meta pending new static creative" -> is_task true, confidence 0.9
- "Review weekly report for feedback/changes" -> is_task true, confidence 0.5 (recurring, fuzzy done-state — must be reviewed by a human, not auto-created)
- "Analyze tubs and bath creative performance" -> is_task true, confidence 0.45 (no clear done-state)
- "Create Facebook page for Timeshare campaign" -> is_task true, confidence 0.9

confidence is your certainty that this deserves to appear on someone's board unreviewed, 0..1.
Use 0.8 or above ONLY for a specific action with an unambiguous done-state.
is_task_reason is ONE short sentence a human will read to understand why it is in their queue.`;

export async function runGateA(
  candidates: CandidateRow[],
  apiKey: string,
): Promise<Map<string, GateAResult>> {
  const out = new Map<string, GateAResult>();
  for (let i = 0; i < candidates.length; i += GATE_BATCH_SIZE) {
    const batch = candidates.slice(i, i + GATE_BATCH_SIZE);
    const prompt = `Judge each line. Respond with json {"results":[{"key":"<key>","is_task":true,"confidence":0.0,"is_task_reason":"..."}]} covering every key exactly once.

LINES:
${batch.map((c) => `- key: ${c.id}\n  text: ${JSON.stringify(c.raw_text.slice(0, 600))}`).join("\n")}`;

    const parsed = await askModel(GATE_A_SYSTEM, prompt, apiKey);
    const results = Array.isArray(parsed?.results) ? parsed.results : null;
    if (!results) {
      // No verdict is not a pass: everything in this batch queues for a human.
      for (const c of batch) {
        out.set(c.id, {
          is_task: true,
          confidence: 0,
          is_task_reason: "Quality check unavailable — queued for human review.",
          decided_by: "unavailable",
        });
      }
      continue;
    }
    const byKey = new Map<string, any>(results.map((r: any) => [String(r?.key ?? ""), r]));
    for (const c of batch) {
      const r = byKey.get(c.id);
      out.set(c.id, r
        ? {
          is_task: r.is_task !== false,
          confidence: Math.max(0, Math.min(1, Number(r.confidence) || 0)),
          is_task_reason: String(r.is_task_reason ?? "").slice(0, 400) || "No reasoning returned.",
          decided_by: "llm",
        }
        : {
          is_task: true,
          confidence: 0,
          is_task_reason: "Model returned no verdict for this line — queued for human review.",
          decided_by: "unavailable",
        });
    }
  }
  return out;
}

// ──────────────────────────── Gate B ────────────────────────────

const GATE_B_SYSTEM = `You decide whether two task descriptions describe THE SAME piece of work.
Return json only: {"results":[{"key":"<key>","same_work":true,"reason":"..."}]}.
same_work is true only if completing one would complete the other. Different campaigns,
different platforms, different assets or different time periods are NOT the same work.
When unsure, answer false — a human will look at it.`;

interface DupCheck { key: string; candidate: string; existing: string; taskId: string; similarity: number }

/**
 * Gate B. Exact normalised match first, then trigram near-matches confirmed by the
 * model. A near match that the model does not confirm stays pending and is shown to a
 * human beside the task it resembles.
 */
export async function runGateB(
  supabase: any,
  candidates: CandidateRow[],
  apiKey: string,
): Promise<Map<string, GateOutcome["gate_b"]>> {
  const out = new Map<string, GateOutcome["gate_b"]>();
  const none: GateOutcome["gate_b"] = {
    duplicate: false, duplicate_of_task_id: null, match_title: null,
    similarity: null, near_duplicate: false, confirmed_by: "none",
  };

  // Open tasks per client, loaded once.
  const clientIds = [...new Set(candidates.map((c) => c.client_id))];
  const openTasks = new Map<string, { id: string; title: string }[]>();
  for (const cid of clientIds) {
    let q = supabase.from("tasks").select("id, title, status, client_id, type_data")
      .not("status", "in", "(done,archived)").limit(2000);
    q = cid === null ? q.is("client_id", null) : q.eq("client_id", cid);
    const { data } = await q;
    openTasks.set(
      String(cid),
      (data ?? [])
        .filter((t: any) => !t.type_data?.archived_reason)
        .map((t: any) => ({ id: t.id, title: t.title })),
    );
  }

  const pending: DupCheck[] = [];
  const seenInRun = new Map<string, string>(); // normalised text -> candidate id

  for (const c of candidates) {
    const norm = normaliseText(c.proposed_title);
    const tasks = openTasks.get(String(c.client_id)) ?? [];

    const exact = tasks.find((t) => normaliseText(t.title) === norm);
    if (exact) {
      out.set(c.id, {
        duplicate: true, duplicate_of_task_id: exact.id, match_title: exact.title,
        similarity: 1, near_duplicate: true, confirmed_by: "exact",
      });
      continue;
    }
    // Another candidate in this same run proposing the same thing.
    if (seenInRun.has(norm)) {
      out.set(c.id, {
        duplicate: true, duplicate_of_task_id: null, match_title: c.proposed_title,
        similarity: 1, near_duplicate: true, confirmed_by: "exact",
      });
      continue;
    }
    seenInRun.set(norm, c.id);

    // Trigram near-matches, then model confirmation.
    let best: { id: string; title: string; sim: number } | null = null;
    const { data: similar } = await supabase.rpc("find_similar_open_tasks", {
      p_client_id: c.client_id,
      p_text: c.proposed_title,
      p_threshold: NEAR_DUPLICATE_THRESHOLD,
      p_limit: 3,
    });
    for (const s of similar ?? []) {
      const sim = Number(s.similarity) || 0;
      if (!best || sim > best.sim) best = { id: s.id, title: s.title, sim };
    }
    if (!best) {
      for (const t of tasks) {
        const sim = trigramSimilarity(c.proposed_title, t.title);
        if (sim >= NEAR_DUPLICATE_THRESHOLD && (!best || sim > best.sim)) {
          best = { id: t.id, title: t.title, sim };
        }
      }
    }
    if (!best) { out.set(c.id, { ...none }); continue; }

    out.set(c.id, {
      duplicate: false, duplicate_of_task_id: best.id, match_title: best.title,
      similarity: Number(best.sim.toFixed(3)), near_duplicate: true, confirmed_by: "none",
    });
    pending.push({ key: c.id, candidate: c.proposed_title, existing: best.title, taskId: best.id, similarity: best.sim });
  }

  for (let i = 0; i < pending.length; i += GATE_BATCH_SIZE) {
    const batch = pending.slice(i, i + GATE_BATCH_SIZE);
    const prompt = `Compare each pair.

PAIRS:
${batch.map((p) => `- key: ${p.key}\n  a: ${JSON.stringify(p.candidate)}\n  b: ${JSON.stringify(p.existing)}`).join("\n")}`;
    const parsed = await askModel(GATE_B_SYSTEM, prompt, apiKey);
    const results = Array.isArray(parsed?.results) ? parsed.results : [];
    for (const r of results) {
      const key = String(r?.key ?? "");
      const hit = batch.find((p) => p.key === key);
      if (!hit || r?.same_work !== true) continue;
      out.set(key, {
        duplicate: true, duplicate_of_task_id: hit.taskId, match_title: hit.existing,
        similarity: Number(hit.similarity.toFixed(3)), near_duplicate: true, confirmed_by: "llm",
      });
    }
  }

  for (const c of candidates) if (!out.has(c.id)) out.set(c.id, { ...none });
  return out;
}

// ──────────────────────────── Gate C ────────────────────────────

const GATE_C_SYSTEM = `You decide whether later context shows a task is ALREADY DONE.
Return json only: {"results":[{"key":"<key>","completed":true,"evidence":"..."}]}.
Answer true only when the context states plainly that the work happened ("paused it this morning",
"page is live", "sent the report"). Plans, intentions and discussions are NOT completion.
When unsure answer false — a human will look at it. Keep evidence to one short quote.`;

const STOPWORDS = new Set(
  "the a an and or for of to in on with from at by new this that into pending per".split(" "),
);

function searchTerms(text: string): string[] {
  return normaliseText(text).split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w))
    .slice(0, 5);
}

export async function runGateC(
  supabase: any,
  candidates: CandidateRow[],
  apiKey: string,
): Promise<Map<string, GateOutcome["gate_c"]>> {
  const out = new Map<string, GateOutcome["gate_c"]>();
  const checks: { key: string; text: string; context: string }[] = [];

  for (const c of candidates) {
    out.set(c.id, { appears_completed: false, evidence: null });
    const terms = searchTerms(c.proposed_title);
    if (terms.length < 2 || !c.client_id) continue;

    const after = typeof c.source_ref?.meeting_date === "string"
      ? String(c.source_ref.meeting_date)
      : c.created_at ?? new Date(Date.now() - 30 * 86400000).toISOString();

    const { data } = await supabase
      .from("context_items")
      .select("title, content, occurred_at")
      .eq("client_id", c.client_id)
      .gt("occurred_at", after)
      .textSearch("search_vector", terms.join(" or "), { type: "websearch", config: "english" })
      .order("occurred_at", { ascending: false })
      .limit(3);

    if (!data || data.length === 0) continue;
    const context = data
      .map((r: any) => `[${String(r.occurred_at).slice(0, 10)}] ${String(r.content ?? "").slice(0, 900)}`)
      .join("\n---\n");
    checks.push({ key: c.id, text: c.proposed_title, context });
  }

  for (let i = 0; i < checks.length; i += GATE_BATCH_SIZE) {
    const batch = checks.slice(i, i + GATE_BATCH_SIZE);
    const prompt = `For each task, decide from the later context whether it is already done.

ITEMS:
${batch.map((b) => `- key: ${b.key}\n  task: ${JSON.stringify(b.text)}\n  later_context: ${JSON.stringify(b.context.slice(0, 2500))}`).join("\n")}`;
    const parsed = await askModel(GATE_C_SYSTEM, prompt, apiKey);
    for (const r of (Array.isArray(parsed?.results) ? parsed.results : [])) {
      const key = String(r?.key ?? "");
      if (!out.has(key) || r?.completed !== true) continue;
      out.set(key, { appears_completed: true, evidence: String(r?.evidence ?? "").slice(0, 400) || null });
    }
  }
  return out;
}

// ──────────────────────────── Scoring + promotion ────────────────────────────

export function decide(
  candidate: CandidateRow,
  a: GateAResult,
  b: GateOutcome["gate_b"],
  c: GateOutcome["gate_c"],
): GateOutcome {
  const blocked: string[] = [];
  if (!a.is_task) blocked.push("not_a_task");
  if (a.confidence < AUTO_PROMOTE_CONFIDENCE) blocked.push("low_confidence");
  if (b.duplicate) blocked.push("duplicate");
  if (b.near_duplicate && !b.duplicate) blocked.push("near_duplicate");
  if (c.appears_completed) blocked.push("appears_completed");
  if (candidate.owner_side !== "cpm") blocked.push("owner_not_cpm");
  if (!candidate.proposed_assignee_id) blocked.push("no_owner");

  return { gate_a: a, gate_b: b, gate_c: c, auto_promote: blocked.length === 0, blocked_by: blocked };
}

export interface GateRunSummary {
  scored: number;
  promoted: number;
  merged: number;
  rejected_not_a_task: number;
  rejected_completed: number;
  pending: number;
}

/** Copies a candidate into `tasks` and links both rows together. */
export async function promoteCandidate(
  supabase: any,
  candidate: CandidateRow,
  gate: GateOutcome,
  reviewerId: string | null = null,
): Promise<string | null> {
  const ref = candidate.source_ref ?? {};
  const meetingDate = typeof ref.meeting_date === "string" ? ref.meeting_date : null;
  const due = meetingDate
    ? new Date(new Date(meetingDate).getTime() + 7 * 86400000).toISOString().slice(0, 10)
    : new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const fresh = meetingDate ? Date.now() - new Date(meetingDate).getTime() <= 7 * 86400000 : true;

  const { data: task, error } = await supabase.from("tasks").insert({
    client_id: candidate.client_id,
    title: candidate.proposed_title,
    description: candidate.raw_text,
    task_type: "general",
    status: candidate.owner_side === "cpm" && fresh ? "todo" : "backlog",
    priority: "medium",
    assignee_id: candidate.proposed_assignee_id,
    created_by_id: reviewerId,
    due_date: due,
    type_data: {
      ...ref,
      source: candidate.source,
      owner_raw: candidate.owner_raw,
      owner_side: candidate.owner_side,
      needs_owner: !candidate.proposed_assignee_id,
      needs_confirmation: !fresh,
      candidate_id: candidate.id,
      gate_results: gate,
    },
  }).select("id").maybeSingle();

  if (error) {
    console.error("task-gate: promote failed —", error.message);
    return null;
  }

  await supabase.from("task_candidates").update({
    status: "promoted",
    promoted_task_id: task?.id ?? null,
    gate_results: gate,
    confidence: gate.gate_a.confidence,
    reviewed_by_id: reviewerId,
    reviewed_at: new Date().toISOString(),
  }).eq("id", candidate.id);

  return task?.id ?? null;
}

/** Runs all three gates over pending candidates and applies the outcome. */
export async function gateCandidates(
  supabase: any,
  candidates: CandidateRow[],
  apiKey: string,
): Promise<{ summary: GateRunSummary; outcomes: Map<string, GateOutcome> }> {
  const outcomes = new Map<string, GateOutcome>();
  const summary: GateRunSummary = {
    scored: candidates.length, promoted: 0, merged: 0,
    rejected_not_a_task: 0, rejected_completed: 0, pending: 0,
  };
  if (candidates.length === 0) return { summary, outcomes };

  const aResults = await runGateA(candidates, apiKey);
  const survivors = candidates.filter((c) => aResults.get(c.id)?.is_task !== false);
  const bResults = await runGateB(supabase, survivors, apiKey);
  const notDuplicates = survivors.filter((c) => !bResults.get(c.id)?.duplicate);
  const cResults = await runGateC(supabase, notDuplicates, apiKey);

  for (const c of candidates) {
    const a = aResults.get(c.id)!;
    const b = bResults.get(c.id) ?? {
      duplicate: false, duplicate_of_task_id: null, match_title: null,
      similarity: null, near_duplicate: false, confirmed_by: "none" as const,
    };
    const gc = cResults.get(c.id) ?? { appears_completed: false, evidence: null };
    const gate = decide(c, a, b, gc);
    outcomes.set(c.id, gate);

    if (!a.is_task) {
      summary.rejected_not_a_task++;
      await supabase.from("task_candidates").update({
        status: "rejected", rejected_reason: "not_a_task",
        gate_results: gate, confidence: a.confidence,
      }).eq("id", c.id);
      continue;
    }
    if (b.duplicate) {
      summary.merged++;
      await supabase.from("task_candidates").update({
        status: "merged", duplicate_of_task_id: b.duplicate_of_task_id,
        gate_results: gate, confidence: a.confidence,
      }).eq("id", c.id);
      continue;
    }
    if (gc.appears_completed) {
      summary.rejected_completed++;
      await supabase.from("task_candidates").update({
        status: "rejected", rejected_reason: "appears_completed",
        gate_results: gate, confidence: a.confidence,
      }).eq("id", c.id);
      continue;
    }
    if (gate.auto_promote) {
      const id = await promoteCandidate(supabase, c, gate);
      if (id) { summary.promoted++; continue; }
    }
    summary.pending++;
    await supabase.from("task_candidates").update({
      status: "pending", gate_results: gate, confidence: a.confidence,
    }).eq("id", c.id);
  }

  return { summary, outcomes };
}
