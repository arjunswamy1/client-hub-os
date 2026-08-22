import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { buildBuyologyPayload, ProductLine } from "../_shared/buyology-payload.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BUYOLOGY_CLIENT_ID = "b3d600f5-5d6b-4378-aa96-b395c05e9297";

interface CreativePayload {
  adName: string;
  line: string;
  campaign: string | null;
  adset: string | null;
  format: string | null;
  status: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpm: number;
  calls: number;
  connected: number;
  qualified: number;
  premium: number;
  converted: number;
  avgTalkSeconds: number;
  qualityScore: number;
  costPerCall: number;
  costPerQualifiedCall: number;
}

interface Body {
  line: string;
  lineLabel: string;
  rangeLabel?: string;
  totals: Record<string, number>;
  creatives: CreativePayload[];
  unattributedCalls?: number;
  attributionRate?: number;
  notes?: string;
  /** rebuild the payload server-side from the database (used by scheduled runs) */
  build?: boolean;
  source?: "manual" | "scheduled";
  periodKey?: string;
}

const round = (n: number, d = 2) => Math.round((Number(n) || 0) * 10 ** d) / 10 ** d;

function validate(b: any): { ok: true; body: Body } | { ok: false; error: string } {
  if (!b || typeof b !== "object") return { ok: false, error: "Body must be an object" };
  if (typeof b.line !== "string" || !b.line) return { ok: false, error: "line is required" };
  if (b.build === true) return { ok: true, body: b as Body };
  if (typeof b.lineLabel !== "string" || !b.lineLabel) return { ok: false, error: "lineLabel is required" };
  if (!b.totals || typeof b.totals !== "object") return { ok: false, error: "totals is required" };
  if (!Array.isArray(b.creatives)) return { ok: false, error: "creatives must be an array" };
  if (b.creatives.length > 200) return { ok: false, error: "Too many creatives (max 200)" };
  return { ok: true, body: b as Body };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY is not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const parsedBody = validate(await req.json().catch(() => null));
    if (!parsedBody.ok) {
      return new Response(JSON.stringify({ error: parsedBody.error }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    let body = parsedBody.body;

    if (body.build) {
      if (!["tubs", "bath"].includes(body.line)) {
        return new Response(JSON.stringify({ error: "line must be 'tubs' or 'bath' when build is true" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const built = await buildBuyologyPayload(admin, BUYOLOGY_CLIENT_ID, body.line as ProductLine);
      if (!built.hasData) {
        return new Response(JSON.stringify({ error: `No creative data for ${body.line} — sync Meta spend and import calls first.` }), {
          status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      body = { ...built.payload, rangeLabel: body.rangeLabel, notes: body.notes, source: body.source, periodKey: body.periodKey };
    }


    // Keep the payload tight: the biggest spenders and the biggest call drivers.
    const bySpend = [...body.creatives].sort((a, b) => b.spend - a.spend).slice(0, 40);
    const byCalls = [...body.creatives].sort((a, b) => b.calls - a.calls).slice(0, 40);
    const seen = new Set<string>();
    const compact = [...bySpend, ...byCalls]
      .filter((c) => (seen.has(c.adName) ? false : (seen.add(c.adName), true)))
      .map((c) => ({
        ad: c.adName,
        campaign: c.campaign,
        adset: c.adset,
        status: c.status,
        format: c.format,
        spend: round(c.spend, 0),
        clicks: c.clicks,
        ctr: round(c.ctr),
        cpm: round(c.cpm),
        calls: c.calls,
        connected: c.connected,
        qualified60s: c.qualified,
        premium120s: c.premium,
        converted: c.converted,
        avgTalk: round(c.avgTalkSeconds, 0),
        quality: c.qualityScore,
        cpc_call: round(c.costPerCall),
        cost_per_qualified_call: round(c.costPerQualifiedCall),
      }));

    const prompt = `You are a senior pay-per-call media buying strategist. You are writing an optimization brief for Belu, the media buyer running Meta Ads for BuyologyIQ (US home improvement lead generation, calls tracked in Ringba).

PRODUCT LINE UNDER REVIEW: ${body.lineLabel}
Reporting window: ${body.rangeLabel || "lifetime to date"}

How quality is defined: a "qualified" call has 60+ seconds of talk time, a "premium" call has 120+ seconds. Cost per qualified call (CPQC) is the north-star efficiency metric. Revenue data may be incomplete, so do not build the plan on ROAS.

LINE TOTALS:
${JSON.stringify(body.totals, null, 1)}

Attribution coverage: ${Math.round((body.attributionRate || 0) * 100)}% of calls carry a creative (utm_content) match. Unattributed calls: ${body.unattributedCalls || 0}.

CREATIVE-LEVEL DATA (Meta ad spend joined to Ringba calls):
${JSON.stringify(compact, null, 1)}

${body.notes ? `Buyer notes: ${body.notes}\n` : ""}
Write the plan. Rules:
- Be specific and executable inside Meta Ads Manager: name the exact ad, ad set or campaign, and give a concrete budget/bid/audience/creative action with numbers.
- Quantify impact using the data given (e.g. "reallocating $X at the $Y CPQC benchmark returns ~Z qualified calls/week"). Never invent metrics that are not derivable from the data.
- Do not recommend anything on creatives with less than $25 spend unless the point is that they need more data.
- Call out attribution/tracking hygiene when coverage is below 80%.
- Prioritize: highest expected impact first.

Return ONLY valid JSON in this exact shape:
{
  "summary": "3-5 sentence executive summary written to Belu",
  "diagnosis": ["short bullet on what the data says", "..."],
  "benchmarks": { "cost_per_qualified_call": 0, "qualified_rate": 0, "note": "how to read these" },
  "recommendations": [
    {
      "priority": 1,
      "type": "scale|cut|reallocate|creative_test|audience|bidding|tracking",
      "severity": "high|medium|low",
      "entity": "exact ad / ad set / campaign name",
      "title": "short action title",
      "action": "exactly what Belu should do, with numbers",
      "rationale": "why, citing the metrics",
      "projected_impact": "quantified expected outcome",
      "confidence": "high|medium|low"
    }
  ],
  "budget_shifts": [ { "from": "entity", "to": "entity", "amount_usd": 0, "reason": "why" } ],
  "creative_tests": [ { "hypothesis": "what to test", "how": "how to build it", "measure": "success metric + threshold" } ],
  "watchouts": ["risk or data caveat", "..."]
}`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.25,
        max_tokens: 5000,
      }),
    });

    if (aiResponse.status === 429) {
      const retryAfter = aiResponse.headers.get("Retry-After");
      return new Response(JSON.stringify({ error: "AI is rate limited — try again in a minute.", retryAfter }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (aiResponse.status === 402 || aiResponse.status === 403) {
      let message = aiResponse.status === 402
        ? "AI credits are exhausted. Add credits in Lovable (Settings → Plans & credits) to run the optimizer."
        : "Lovable AI is blocked for this workspace (disabled or a credit limit was reached). A workspace admin needs to unblock it.";
      try {
        const j = await aiResponse.json();
        if (j?.error?.message || j?.message) message = j.error?.message || j.message;
      } catch { /* keep default */ }
      return new Response(JSON.stringify({ error: message, blocked: true }), {
        status: aiResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      return new Response(JSON.stringify({ error: `AI error [${aiResponse.status}]: ${errText.substring(0, 300)}` }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    let content: string = aiData.choices?.[0]?.message?.content || "";
    content = content.trim();
    if (content.startsWith("```")) {
      content = content.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    let plan: any;
    try {
      plan = JSON.parse(content);
    } catch {
      const start = content.indexOf("{");
      const end = content.lastIndexOf("}");
      if (start === -1 || end === -1) {
        return new Response(JSON.stringify({ error: "AI returned an unreadable plan — try again." }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      plan = JSON.parse(content.slice(start, end + 1));
    }

    const generatedAt = new Date().toISOString();
    const source = body.source === "scheduled" ? "scheduled" : "manual";
    const periodKey = body.periodKey || generatedAt.slice(0, 10);

    // Persist for history (best effort — never fail the request on a logging error)
    try {
      const recs = Array.isArray(plan.recommendations) ? plan.recommendations.slice(0, 25) : [];
      if (recs.length) {
        await admin.from("ai_optimization_recommendations").insert(
          recs.map((r: any) => ({
            client_id: BUYOLOGY_CLIENT_ID,
            platform: "meta",
            recommendation_type: String(r.type || "optimization"),
            entity_type: "creative",
            entity_name: String(r.entity || body.lineLabel).slice(0, 300),
            severity: ["high", "medium", "low"].includes(r.severity) ? r.severity : "medium",
            title: String(r.title || "Optimization").slice(0, 300),
            description: [r.action, r.rationale].filter(Boolean).join("\n\n"),
            recommended_action: { action: r.action ?? null, confidence: r.confidence ?? null, priority: r.priority ?? null },
            projected_impact: { detail: r.projected_impact ?? null },
            current_metrics: { product_line: body.line, totals: body.totals },
          }))
        );
      }
    } catch (logErr) {
      console.error("buyology-optimizer: failed to persist recommendations", logErr);
    }

    // Snapshot the brief itself so briefs can be compared by date.
    try {
      if (source === "scheduled") {
        await admin.from("ai_optimizer_briefs").delete()
          .eq("client_id", BUYOLOGY_CLIENT_ID).eq("scope", "buyology")
          .eq("product_line", body.line).eq("period_key", periodKey).eq("source", "scheduled");
      }
      await admin.from("ai_optimizer_briefs").insert({
        client_id: BUYOLOGY_CLIENT_ID,
        scope: "buyology",
        product_line: body.line,
        line_label: body.lineLabel,
        range_label: body.rangeLabel || "lifetime to date",
        source,
        plan,
        totals: body.totals,
        attribution_rate: body.attributionRate ?? null,
        period_key: periodKey,
        generated_at: generatedAt,
      });
    } catch (snapErr) {
      console.error("buyology-optimizer: failed to snapshot brief", snapErr);
    }

    return new Response(JSON.stringify({ line: body.line, lineLabel: body.lineLabel, plan, totals: body.totals, generatedAt }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("buyology-optimizer error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
