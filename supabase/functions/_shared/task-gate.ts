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
/** Duplicate pairs sent per confirmation call — one call per pair rate-limits the gateway. */
export const GATE_B_PAIRS_PER_CALL = 25;
/** Trigram similarity at or above this is a *near* match — never a duplicate on its own. */
export const NEAR_DUPLICATE_THRESHOLD = 0.45;
/** At or above this the pair is plainly the same wording — merge without a model call. */
export const HIGH_SIMILARITY_THRESHOLD = 0.9;
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
  confidence?: number | null;
}

export interface GateAResult {
  is_task: boolean;
  confidence: number;
  is_task_reason: string;
  decided_by: "llm" | "unavailable" | "machine";
  source_appears_completed: boolean;
  completion_evidence: string | null;
}

export interface GateOutcome {
  gate_a: GateAResult;
  gate_b: {
    duplicate: boolean;
    duplicate_of_task_id: string | null;
    match_title: string | null;
    similarity: number | null;
    near_duplicate: boolean;
    merged_into_candidate_id: string | null;
    /** null means the check could not run — the next scheduled run retries the pair. */
    confirmed_by: "exact" | "trigram_high" | "trigram+llm" | "none" | null;
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One streamed gateway call returning parsed json, or null on any failure.
 * 429 and 5xx are retried with backoff, honouring Retry-After when present —
 * the same treatment Slack's rate limits get in sync-slack. Every other status
 * is terminal per the gateway error contract.
 */
export async function askModel(
  instructions: string,
  prompt: string,
  apiKey: string,
  maxAttempts = 4,
): Promise<any | null> {
  if (!apiKey) return null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
        const detail = (await res.text()).slice(0, 400);
        const retryable = res.status === 429 || res.status >= 500;
        console.error("task-gate: gateway error", res.status, detail);
        if (!retryable || attempt === maxAttempts) return null;
        const retryAfter = Number(res.headers.get("Retry-After"));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter, 30) * 1000
          : Math.min(2 ** attempt * 1000, 16000) + Math.floor(Math.random() * 500);
        console.log(`task-gate: retrying in ${waitMs}ms (attempt ${attempt}/${maxAttempts})`);
        await sleep(waitMs);
        continue;
      }
      const text = parseSse(await res.text());
      if (!text.trim()) {
        console.error("task-gate: empty model output");
        return null;
      }
      return JSON.parse(text.replace(/```json\s*/g, "").replace(/```/g, "").trim());
    } catch (e) {
      console.error("task-gate: model call failed —", e instanceof Error ? e.message : String(e));
      if (attempt === maxAttempts) return null;
      await sleep(Math.min(2 ** attempt * 1000, 16000));
    }
  }
  return null;
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
is_task_reason is ONE short sentence a human will read to understand why it is in their queue.
source_appears_completed is true when the line itself says the work already happened; copy the shortest
supporting phrase into completion_evidence. This makes completion visible in Gate C as well as Gate A.`;

/**
 * Sources whose items are produced by a deterministic check, not extracted from human
 * chatter. Gate A's rubric was written to judge meeting lines and Slack messages; applied
 * to a monitor finding it reads "BuyologyIQ: spend zero since Sep 16" as an observation
 * and rejects it, which is exactly backwards — the finding is a verified condition with a
 * named done-state (the condition clears). These bypass Gate A; B and C still run.
 */
const MACHINE_SOURCES = new Set(["data_integrity"]);

export async function runGateA(
  candidates: CandidateRow[],
  apiKey: string,
): Promise<Map<string, GateAResult>> {
  const out = new Map<string, GateAResult>();
  for (const c of candidates) {
    if (!MACHINE_SOURCES.has(c.source)) continue;
    out.set(c.id, {
      is_task: true,
      confidence: 0.9,
      is_task_reason:
        "Filed by a deterministic integrity check that carries the query proving the condition; done when the condition clears.",
      decided_by: "machine",
      source_appears_completed: false,
      completion_evidence: null,
    });
  }
  const judged = candidates.filter((c) => !MACHINE_SOURCES.has(c.source));
  for (let i = 0; i < judged.length; i += GATE_BATCH_SIZE) {
    const batch = judged.slice(i, i + GATE_BATCH_SIZE);

    const prompt = `Judge each line. Respond with json {"results":[{"key":"<key>","is_task":true,"confidence":0.0,"is_task_reason":"...","source_appears_completed":false,"completion_evidence":null}]} covering every key exactly once.

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
          source_appears_completed: false,
          completion_evidence: null,
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
          source_appears_completed: r.source_appears_completed === true,
          completion_evidence: r.source_appears_completed === true
            ? String(r.completion_evidence ?? r.is_task_reason ?? "").slice(0, 400) || null
            : null,
        }
        : {
          is_task: true,
          confidence: 0,
          is_task_reason: "Model returned no verdict for this line — queued for human review.",
          decided_by: "unavailable",
          source_appears_completed: false,
          completion_evidence: null,
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

interface DupCheck {
  key: string;
  candidateId: string;
  candidate: string;
  existing: string;
  taskId: string | null;
  matchCandidateId: string | null;
  similarity: number;
}

function rankCandidate(c: CandidateRow, aResults: Map<string, GateAResult>): [number, number, string] {
  return [aResults.get(c.id)?.confidence ?? c.confidence ?? 0, c.proposed_title.length, c.id];
}

function ranksBefore(a: CandidateRow, b: CandidateRow, aResults: Map<string, GateAResult>): boolean {
  const ar = rankCandidate(a, aResults);
  const br = rankCandidate(b, aResults);
  if (ar[0] !== br[0]) return ar[0] > br[0];
  if (ar[1] !== br[1]) return ar[1] > br[1];
  return ar[2] < br[2];
}

/**
 * Gate B. Both task and pending-candidate trigram searches shortlist pairs.
 * Fuzzy pairs merge only after the model confirms that completing one completes the other.
 */
export async function runGateB(
  supabase: any,
  candidates: CandidateRow[],
  apiKey: string,
  aResults: Map<string, GateAResult>,
): Promise<Map<string, GateOutcome["gate_b"]>> {
  const out = new Map<string, GateOutcome["gate_b"]>();
  const none = (): GateOutcome["gate_b"] => ({
    duplicate: false, duplicate_of_task_id: null, match_title: null,
    similarity: null, near_duplicate: false, merged_into_candidate_id: null, confirmed_by: "none",
  });
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const pending: DupCheck[] = [];

  for (const c of candidates) {
    const norm = normaliseText(c.proposed_title);
    const { data: taskMatches, error: taskError } = await supabase.rpc("find_similar_open_tasks", {
      p_client_id: c.client_id, p_text: c.proposed_title,
      p_threshold: NEAR_DUPLICATE_THRESHOLD, p_limit: 5,
    });
    const { data: candidateMatches, error: candidateError } = await supabase.rpc("find_similar_pending_candidates", {
      p_client_id: c.client_id, p_text: c.proposed_title, p_exclude_id: c.id,
      p_threshold: NEAR_DUPLICATE_THRESHOLD, p_limit: 5,
    });
    if (taskError || candidateError) {
      console.error("task-gate: duplicate search failed", taskError?.message, candidateError?.message);
      // Not a verdict — leave it unchecked so the next run retries this row.
      out.set(c.id, { ...none(), confirmed_by: null });
      continue;
    }

    const exactTask = (taskMatches ?? []).find((t: any) => normaliseText(t.title) === norm);
    if (exactTask) {
      out.set(c.id, {
        duplicate: true, duplicate_of_task_id: exactTask.id, match_title: exactTask.title,
        similarity: 1, near_duplicate: true, merged_into_candidate_id: null, confirmed_by: "exact",
      });
      continue;
    }

    const exactCandidate = (candidateMatches ?? [])
      .map((m: any) => byId.get(m.id) ?? ({
        id: m.id, proposed_title: m.proposed_title, confidence: m.confidence,
      } as CandidateRow))
      .filter((other: CandidateRow) => aResults.get(other.id)?.is_task !== false)
      .filter((other: CandidateRow | undefined): other is CandidateRow => !!other && normaliseText(other.proposed_title) === norm)
      .filter((other: CandidateRow) => ranksBefore(other, c, aResults))
      .sort((x: CandidateRow, y: CandidateRow) => ranksBefore(x, y, aResults) ? -1 : 1)[0];
    if (exactCandidate) {
      out.set(c.id, {
        duplicate: true, duplicate_of_task_id: null, match_title: exactCandidate.proposed_title,
        similarity: 1, near_duplicate: true, merged_into_candidate_id: exactCandidate.id, confirmed_by: "exact",
      });
      continue;
    }

    const shortlist: DupCheck[] = [];
    for (const match of taskMatches ?? []) {
      shortlist.push({
        key: `${c.id}|task|${match.id}`, candidateId: c.id, candidate: c.proposed_title,
        existing: match.title, taskId: match.id, matchCandidateId: null,
        similarity: Number(match.similarity) || 0,
      });
    }
    for (const match of candidateMatches ?? []) {
      const other = byId.get(match.id) ?? ({
        id: match.id, proposed_title: match.proposed_title, confidence: match.confidence,
      } as CandidateRow);
      if (aResults.get(other.id)?.is_task === false) continue;
      if (!ranksBefore(other, c, aResults)) continue;
      shortlist.push({
        key: `${c.id}|candidate|${match.id}`, candidateId: c.id, candidate: c.proposed_title,
        existing: match.proposed_title, taskId: null, matchCandidateId: match.id,
        similarity: Number(match.sim) || 0,
      });
    }

    if (shortlist.length === 0) {
      out.set(c.id, none());
      continue;
    }

    shortlist.sort((x, y) => y.similarity - x.similarity);
    const best = shortlist[0];
    // Near-identical wording needs no adjudication — and needing the gateway up
    // for the common case is exactly what made this pipeline fragile.
    if (best.similarity >= HIGH_SIMILARITY_THRESHOLD) {
      out.set(c.id, {
        duplicate: true, duplicate_of_task_id: best.taskId, match_title: best.existing,
        similarity: Number(best.similarity.toFixed(3)), near_duplicate: true,
        merged_into_candidate_id: best.matchCandidateId, confirmed_by: "trigram_high",
      });
      continue;
    }

    // Ambiguous band: the model decides. Until it answers this stays unchecked (null).
    for (const pair of shortlist) {
      if (pair.similarity < HIGH_SIMILARITY_THRESHOLD) pending.push(pair);
    }
    out.set(c.id, {
      duplicate: false, duplicate_of_task_id: best.taskId, match_title: best.existing,
      similarity: Number(best.similarity.toFixed(3)), near_duplicate: true,
      merged_into_candidate_id: best.matchCandidateId, confirmed_by: null,
    });
  }

  for (let i = 0; i < pending.length; i += GATE_B_PAIRS_PER_CALL) {
    const batch = pending.slice(i, i + GATE_B_PAIRS_PER_CALL);
    const prompt = `Compare each pair and return the required json object.

PAIRS:
${batch.map((p) => `- key: ${p.key}\n  a: ${JSON.stringify(p.candidate)}\n  b: ${JSON.stringify(p.existing)}`).join("\n")}`;
    const parsed = await askModel(GATE_B_SYSTEM, prompt, apiKey);
    const results = Array.isArray(parsed?.results) ? parsed.results : null;
    // No answer: leave confirmed_by null so the next scheduled run retries these pairs.
    if (!results) continue;
    const byKey = new Map(results.map((r: any) => [String(r?.key ?? ""), r]));
    const candidateIds = [...new Set(batch.map((p) => p.candidateId))];
    for (const candidateId of candidateIds) {
      const answered = batch.filter((p) => p.candidateId === candidateId && byKey.has(p.key));
      if (answered.length === 0) continue;
      const confirmed = answered
        .filter((p) => byKey.get(p.key)?.same_work === true)
        .sort((x, y) => y.similarity - x.similarity)[0];
      if (confirmed) {
        out.set(candidateId, {
          duplicate: true, duplicate_of_task_id: confirmed.taskId, match_title: confirmed.existing,
          similarity: Number(confirmed.similarity.toFixed(3)), near_duplicate: true,
          merged_into_candidate_id: confirmed.matchCandidateId, confirmed_by: "trigram+llm",
        });
      } else {
        const prior = out.get(candidateId);
        // Only settle to "none" once every shortlisted pair for this candidate got an answer.
        const allAnswered = pending
          .filter((p) => p.candidateId === candidateId)
          .every((p) => batch.includes(p) ? byKey.has(p.key) : false);
        if (prior && !prior.duplicate && allAnswered) {
          out.set(candidateId, { ...prior, near_duplicate: false, confirmed_by: "none" });
        }
      }
    }
  }

  for (const c of candidates) if (!out.has(c.id)) out.set(c.id, none());
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
  aResults?: Map<string, GateAResult>,
): Promise<Map<string, GateOutcome["gate_c"]>> {
  const out = new Map<string, GateOutcome["gate_c"]>();
  const checks: { key: string; text: string; context: string }[] = [];

  const replayTaskIds = candidates
    .map((c) => typeof c.source_ref?.replay_of_archived_task_id === "string" ? c.source_ref.replay_of_archived_task_id : null)
    .filter((id): id is string => !!id);
  const replayDates = new Map<string, string>();
  for (let i = 0; i < replayTaskIds.length; i += 100) {
    const { data } = await supabase.from("tasks").select("id, created_at").in("id", replayTaskIds.slice(i, i + 100));
    for (const row of data ?? []) replayDates.set(row.id, row.created_at);
  }

  for (const c of candidates) {
    const gateA = aResults?.get(c.id);
    out.set(c.id, gateA?.source_appears_completed
      ? { appears_completed: true, evidence: gateA.completion_evidence }
      : { appears_completed: false, evidence: null });
    const terms = searchTerms(c.proposed_title);
    if (terms.length < 2 || !c.client_id) continue;

    const after = typeof c.source_ref?.meeting_date === "string"
      ? String(c.source_ref.meeting_date)
      : replayDates.get(String(c.source_ref?.replay_of_archived_task_id ?? ""))
        ?? c.created_at ?? new Date(Date.now() - 30 * 86400000).toISOString();

    const { data } = await supabase
      .from("context_items")
      .select("title, content, occurred_at")
      .eq("client_id", c.client_id)
      .gt("occurred_at", after)
      .textSearch("search_vector", terms.join(" or "), { type: "websearch", config: "english" })
      .order("occurred_at", { ascending: false })
      .limit(15);

    if (!data || data.length === 0) continue;
    const context = data
      .map((r: any) => `[${String(r.occurred_at).slice(0, 10)}] ${String(r.content ?? "").slice(0, 900)}`)
      .join("\n---\n");
    checks.push({ key: c.id, text: c.proposed_title, context });
  }

  for (let i = 0; i < checks.length; i += GATE_BATCH_SIZE) {
    const batch = checks.slice(i, i + GATE_BATCH_SIZE);
    const prompt = `For each task, decide from the later context whether it is already done and return the required json object.

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
  const bResults = await runGateB(supabase, survivors, apiKey, aResults);
  const cResults = await runGateC(supabase, candidates, apiKey, aResults);

  for (const c of candidates) {
    const a = aResults.get(c.id);
    if (!a) continue;
    const b = bResults.get(c.id) ?? {
      duplicate: false, duplicate_of_task_id: null, match_title: null,
      similarity: null, near_duplicate: false, merged_into_candidate_id: null, confirmed_by: "none" as const,
    };
    const gc = cResults.get(c.id) ?? { appears_completed: false, evidence: null };
    const gate = decide(c, a, b, gc);
    outcomes.set(c.id, gate);

    if (!a.is_task) {
      summary.rejected_not_a_task++;
      await supabase.from("task_candidates").update({
        status: "rejected", rejected_reason: "not_a_task",
        duplicate_of_task_id: null, merged_into_candidate_id: null,
        gate_results: gate, confidence: a.confidence,
      }).eq("id", c.id);
      continue;
    }
    if (b.duplicate) {
      summary.merged++;
      await supabase.from("task_candidates").update({
        status: "merged", duplicate_of_task_id: b.duplicate_of_task_id,
        merged_into_candidate_id: b.merged_into_candidate_id, gate_results: gate, confidence: a.confidence,
      }).eq("id", c.id);
      continue;
    }
    if (gc.appears_completed) {
      summary.rejected_completed++;
      await supabase.from("task_candidates").update({
        status: "rejected", rejected_reason: "appears_completed",
        duplicate_of_task_id: null, merged_into_candidate_id: null,
        gate_results: gate, confidence: a.confidence,
      }).eq("id", c.id);
      continue;
    }
    if (gate.auto_promote) {
      const id = await promoteCandidate(supabase, c, gate);
      if (id) {
        await supabase.from("task_candidates").update({ duplicate_of_task_id: id })
          .eq("merged_into_candidate_id", c.id).eq("status", "merged");
        summary.promoted++;
        continue;
      }
    }
    summary.pending++;
    await supabase.from("task_candidates").update({
      status: "pending", rejected_reason: null, duplicate_of_task_id: null,
      merged_into_candidate_id: null, gate_results: gate, confidence: a.confidence,
    }).eq("id", c.id);
  }

  return { summary, outcomes };
}
