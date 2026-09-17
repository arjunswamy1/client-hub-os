// Model-backed Slack message classification.
//
// The regex classifier in slack-message-class.ts stays as (a) a cheap pre-filter
// that skips obvious noise before we spend a model call and (b) the fallback when
// the model call fails. This module is the primary classifier for everything else.
//
// Bias: UNDER-report. A missed client question is a small loss; a false one costs
// trust in the whole unanswered-questions feature.

import type { MessageClass } from "./slack-message-class.ts";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/responses";
const MODEL = "openai/gpt-6-astra";

export const AI_BATCH_SIZE = 20;

export interface AiClassifyItem {
  /** stable key used to map the answer back onto the message */
  key: string;
  author: string;
  isCpmAuthor: boolean;
  text: string;
  /** surrounding thread text (parent + earlier replies), newest last */
  threadContext?: string;
}

const VALID: MessageClass[] = [
  "client_question",
  "client_request",
  "escalation",
  "client_claim",
  "internal",
  "noise",
];

const SYSTEM = `You classify Slack messages for a paid-media agency ("CPM" = Connect Paid Media).
Return json only.

Classes:
- client_question — someone OUTSIDE CPM is genuinely asking CPM for information and expects a reply.
- client_request — someone outside CPM asks CPM to DO something (pause ads, send a report, change budget).
- escalation — complaint, frustration, anger, or explicit urgency from outside CPM.
- client_claim — someone outside CPM asserts a number or fact about performance we could check against our own data.
- internal — authored by a CPM person.
- noise — greetings, thanks, emoji, scheduling chatter, acknowledgements, anything not needing action.

Rules, in priority order:
1. If is_cpm_author is true the class is ALWAYS "internal".
2. Be conservative about client_question. A trailing "?" is NOT enough. Rhetorical questions,
   thinking aloud, questions the same message already answers, questions clearly aimed at a third
   party, and small talk are "noise". When genuinely unsure, choose "noise".
3. Use thread_context: if the question is already answered inside the same message or is a
   follow-up acknowledgement, it is "noise".
4. Every message gets exactly one class.`;

function buildPrompt(items: AiClassifyItem[]): string {
  const blocks = items.map((it) => {
    const ctx = it.threadContext ? `\n  thread_context: ${it.threadContext.slice(0, 1200)}` : "";
    return `- key: ${it.key}\n  author: ${it.author}\n  is_cpm_author: ${it.isCpmAuthor}\n  text: ${JSON.stringify(it.text.slice(0, 1200))}${ctx}`;
  }).join("\n");

  return `Classify each message below. Respond with json of the shape {"results":[{"key":"<key>","class":"<class>"}]} covering every key exactly once.

MESSAGES:
${blocks}`;
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
    } catch { /* partial frame — ignore */ }
  }
  return out;
}

/**
 * Classify one batch. Returns null on any failure so the caller can fall back to
 * the heuristic classifier for that batch.
 */
export async function classifyBatchWithAi(
  items: AiClassifyItem[],
  apiKey: string,
): Promise<Record<string, MessageClass> | null> {
  if (items.length === 0) return {};
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
        instructions: SYSTEM,
        input: buildPrompt(items),
        stream: true,
        reasoning: { effort: "low", summary: "auto" },
        text: { format: { type: "json_object" } },
      }),
    });

    if (!res.ok) {
      console.error("slack classify: gateway error", res.status, (await res.text()).slice(0, 400));
      return null;
    }

    const text = parseSse(await res.text());
    if (!text.trim()) {
      console.error("slack classify: empty model output");
      return null;
    }

    const cleaned = text.replace(/```json\s*/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    const results = Array.isArray(parsed?.results) ? parsed.results : [];

    const out: Record<string, MessageClass> = {};
    for (const r of results) {
      const key = String(r?.key ?? "");
      const cls = String(r?.class ?? "") as MessageClass;
      if (key && VALID.includes(cls)) out[key] = cls;
    }
    return out;
  } catch (e) {
    console.error("slack classify: call failed —", e instanceof Error ? e.message : String(e));
    return null;
  }
}
