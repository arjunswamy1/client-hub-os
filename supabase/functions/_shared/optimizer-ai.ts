// Shared helpers for generating AI optimization briefs and delivering them to Slack.
import { postToSlack } from './slack-post.ts';

export interface OptimizerPlan {
  summary?: string;
  diagnosis?: string[];
  benchmarks?: Record<string, unknown>;
  recommendations?: Array<{
    priority?: number;
    type?: string;
    severity?: string;
    entity?: string;
    title?: string;
    action?: string;
    rationale?: string;
    projected_impact?: string;
    confidence?: string;
  }>;
  budget_shifts?: Array<{ from?: string; to?: string; amount_usd?: number; reason?: string }>;
  creative_tests?: Array<{ hypothesis?: string; how?: string; measure?: string }>;
  watchouts?: string[];
}

export const PLAN_JSON_SHAPE = `{
  "summary": "3-5 sentence executive summary written to the media buyer",
  "diagnosis": ["short bullet on what the data says", "..."],
  "benchmarks": { "cost_per_raw_call": 0, "note": "how to read these" },
  "recommendations": [
    {
      "priority": 1,
      "type": "scale|cut|reallocate|creative_test|audience|bidding|tracking",
      "severity": "high|medium|low",
      "entity": "exact ad / ad set / campaign / keyword / station name",
      "title": "short action title",
      "action": "exactly what the buyer should do, with numbers",
      "rationale": "why, citing the metrics",
      "projected_impact": "quantified expected outcome",
      "confidence": "high|medium|low"
    }
  ],
  "budget_shifts": [ { "from": "entity", "to": "entity", "amount_usd": 0, "reason": "why" } ],
  "creative_tests": [ { "hypothesis": "what to test", "how": "how to build it", "measure": "success metric + threshold" } ],
  "watchouts": ["risk or data caveat", "..."]
}`;

export class AIBlockedError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Ask Lovable AI for a plan and parse it as JSON. Throws AIBlockedError on 402/403/429. */
export async function generatePlan(prompt: string, apiKey: string): Promise<OptimizerPlan> {
  const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.25,
      max_tokens: 5000,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let message = text.slice(0, 400);
    try { message = JSON.parse(text)?.error?.message || message; } catch { /* raw */ }
    throw new AIBlockedError(res.status, message || `AI error ${res.status}`);
  }

  const data = await res.json();
  let content: string = (data.choices?.[0]?.message?.content || '').trim();
  if (content.startsWith('```')) content = content.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  try {
    return JSON.parse(content) as OptimizerPlan;
  } catch {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('AI returned an unreadable plan');
    return JSON.parse(content.slice(start, end + 1)) as OptimizerPlan;
  }
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Slack Block Kit rendering of a brief — one message per product/service line. */
export function planBlocks(opts: {
  clientLabel: string;
  lineLabel: string;
  rangeLabel: string;
  headlineMetrics: string[];
  plan: OptimizerPlan;
  dashboardUrl?: string;
}): unknown[] {
  const { clientLabel, lineLabel, rangeLabel, headlineMetrics, plan, dashboardUrl } = opts;
  const blocks: unknown[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: truncate(`${clientLabel} — ${lineLabel} optimization brief`, 150) },
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Window: *${rangeLabel}* · generated ${new Date().toISOString().slice(0, 10)}` }],
    },
  ];

  if (headlineMetrics.length) {
    blocks.push({
      type: 'section',
      fields: headlineMetrics.slice(0, 10).map((m) => ({ type: 'mrkdwn', text: truncate(m, 1900) })),
    });
  }

  if (plan.summary) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: truncate(plan.summary, 2900) } });
  }

  const recs = (plan.recommendations || []).slice(0, 5);
  if (recs.length) {
    blocks.push({ type: 'divider' });
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*Top actions this week*' } });
    recs.forEach((r, i) => {
      const sev = r.severity === 'high' ? '🔴' : r.severity === 'low' ? '🟢' : '🟡';
      const lines = [
        `${sev} *${i + 1}. ${truncate(String(r.title || r.type || 'Action'), 140)}*`,
        r.entity ? `_${truncate(String(r.entity), 160)}_` : '',
        r.action ? truncate(String(r.action), 700) : '',
        r.projected_impact ? `→ ${truncate(String(r.projected_impact), 300)}` : '',
      ].filter(Boolean);
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: truncate(lines.join('\n'), 2900) } });
    });
  }

  const shifts = (plan.budget_shifts || []).slice(0, 4);
  if (shifts.length) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: truncate(
          `*Budget shifts*\n${shifts
            .map((s) => `• $${Math.round(Number(s.amount_usd || 0)).toLocaleString()} from *${s.from || '—'}* → *${s.to || '—'}*${s.reason ? ` (${s.reason})` : ''}`)
            .join('\n')}`,
          2900,
        ),
      },
    });
  }

  const watchouts = (plan.watchouts || []).slice(0, 4);
  if (watchouts.length) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: truncate(`*Watchouts*\n${watchouts.map((w) => `• ${w}`).join('\n')}`, 2900) },
    });
  }

  if (dashboardUrl) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `<${dashboardUrl}|Open the ${clientLabel} dashboard>` }] });
  }

  return blocks;
}

/**
 * Post a Block Kit brief. Delegates to the single guarded Slack writer, which
 * owns the token and the fail-closed channel allowlist. Throws on refusal or
 * Slack error so the caller records it against the schedule row.
 */
export async function postSlack(channel: string, text: string, blocks: unknown[]): Promise<string> {
  const out = await postToSlack({ channel, text, blocks, throwOnRefusal: true, throwOnError: true });
  return out.ts || '';
}
