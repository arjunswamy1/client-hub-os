// Shared chat client for edge functions — runs on Lovable AI (OpenAI Responses via the gateway).
// - Converts OpenAI-style messages -> Responses input items
// - Supports tool calling with a built-in `generate_chart` tool that returns
//   a QuickChart.io PNG URL Claude can reference, and that callers can
//   surface in their UI (web chat, Slack uploads, etc.)

import { AI_DEFAULT_MODEL, streamResponses } from "./lovable-ai.ts";

/** Kept for existing callers; now the Lovable AI default model. */
export const ANTHROPIC_DEFAULT_MODEL = AI_DEFAULT_MODEL;

/**
 * Recursively sanitize strings for safe JSON transmission to Anthropic.
 * Removes lone UTF-16 surrogates (cause "no low surrogate" 400 errors)
 * and disallowed control characters.
 */
function sanitizeString(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    // High surrogate — must be followed by a low surrogate
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += s[i] + s[i + 1];
        i++;
        continue;
      }
      out += "\uFFFD";
      continue;
    }
    // Lone low surrogate
    if (code >= 0xdc00 && code <= 0xdfff) {
      out += "\uFFFD";
      continue;
    }
    // Strip C0 control chars except \t (9), \n (10), \r (13)
    if (code < 0x20 && code !== 9 && code !== 10 && code !== 13) continue;
    out += s[i];
  }
  return out;
}

function sanitizeForJson(value: any): any {
  if (typeof value === "string") return sanitizeString(value);
  if (Array.isArray(value)) return value.map(sanitizeForJson);
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const k of Object.keys(value)) out[k] = sanitizeForJson(value[k]);
    return out;
  }
  return value;
}

export interface ChatMessage {
  role: string;
  content: string;
}

export interface GeneratedChart {
  url: string;
  title: string;
  chart_type: string;
}

export interface AnthropicCallOptions {
  model?: string;
  max_tokens?: number;
  temperature?: number;
  system?: string;
  /** Enable the built-in generate_chart tool (default: false) */
  enableCharts?: boolean;
  /** Max number of tool-use rounds (default: 3) */
  maxToolRounds?: number;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface AnthropicResult {
  ok: boolean;
  status: number;
  content: string;
  charts: GeneratedChart[];
  usage?: TokenUsage;
  error?: string;
}

/**
 * Truncate a string to a max length with ellipsis. Safe for sanitized text.
 */
export function truncate(s: string | null | undefined, max: number): string {
  if (!s) return "";
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

// ─── Chart tool definition ──────────────────────────────────────────────

const CHART_TOOL = {
  name: "generate_chart",
  description:
    "Generate a chart visualization from data. Choose the chart type that best fits the story:\n" +
    "- 'line' → trends over TIME (daily spend, weekly ROAS, CPL trajectory). ALWAYS prefer line for any time-series.\n" +
    "- 'bar' → comparing 3+ discrete categories of SIMILAR magnitude (e.g. spend across 5 campaigns).\n" +
    "- 'pie' / 'doughnut' → showing PROPORTIONS of a whole (max 6 slices, values must sum meaningfully).\n" +
    "- 'radar' → comparing one entity across 4+ metrics (rare).\n\n" +
    "CRITICAL RULES:\n" +
    "1. NEVER use a bar/pie chart to compare just 2 values — state them in text instead (e.g. '$521 revenue vs $9.88 spend = 52.7x ROAS').\n" +
    "2. NEVER plot two metrics with wildly different scales (e.g. revenue $500 vs spend $10) on the same axis — one bar will be invisible. Either use a line chart over time, OR show them as separate metrics in text, OR use ratio/derived values (ROAS, CPL, margin %).\n" +
    "3. For time-series data, pass dates as labels in chronological order and use 'line'.\n" +
    "4. Pass REAL data only — never invent numbers. If you don't have time-series data, don't fabricate it.\n" +
    "5. Skip the chart entirely if the insight is better expressed as a single number or short sentence.\n\n" +
    "The tool returns a hosted PNG URL that the user sees inline.",
  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Short chart title shown above the chart (e.g. 'Daily Spend by Platform — Last 14 Days').",
      },
      chart_type: {
        type: "string",
        enum: ["bar", "line", "pie", "doughnut", "radar", "polarArea"],
        description: "Chart type. Strongly prefer 'line' for time-series. Use 'bar' only for 3+ comparable categories.",
      },
      labels: {
        type: "array",
        items: { type: "string" },
        description: "X-axis labels (or slice labels for pie/doughnut). Example: ['Mon','Tue','Wed'].",
      },
      datasets: {
        type: "array",
        description:
          "Array of datasets. For pie/doughnut/polarArea, use exactly ONE dataset. " +
          "For bar/line/radar, you may pass multiple to compare series.",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "Series name shown in legend (e.g. 'Google Ads')." },
            data: {
              type: "array",
              items: { type: "number" },
              description: "Numeric values, one per label. Length must match labels length.",
            },
          },
          required: ["label", "data"],
        },
      },
    },
    required: ["title", "chart_type", "labels", "datasets"],
  },
} as const;

const CHART_PALETTE = [
  "rgba(46, 125, 50, 0.85)",   // brand green
  "rgba(33, 150, 243, 0.85)",  // blue
  "rgba(255, 152, 0, 0.85)",   // orange
  "rgba(156, 39, 176, 0.85)",  // purple
  "rgba(244, 67, 54, 0.85)",   // red
  "rgba(0, 188, 212, 0.85)",   // cyan
  "rgba(255, 193, 7, 0.85)",   // amber
  "rgba(96, 125, 139, 0.85)",  // blue-grey
];

function buildChartUrl(input: {
  title: string;
  chart_type: string;
  labels: string[];
  datasets: { label: string; data: number[] }[];
}): string {
  const isCircular = ["pie", "doughnut", "polarArea"].includes(input.chart_type);

  const datasets = input.datasets.map((ds, i) => {
    if (isCircular) {
      return {
        label: ds.label,
        data: ds.data,
        backgroundColor: ds.data.map((_, j) => CHART_PALETTE[j % CHART_PALETTE.length]),
      };
    }
    const color = CHART_PALETTE[i % CHART_PALETTE.length];
    const isLine = input.chart_type === "line";
    return {
      label: ds.label,
      data: ds.data,
      backgroundColor: isLine ? color.replace("0.85", "0.15") : color,
      borderColor: color.replace("0.85", "1"),
      borderWidth: isLine ? 3 : 2,
      fill: isLine,
      tension: isLine ? 0.35 : undefined,
      pointRadius: isLine ? 4 : undefined,
      pointBackgroundColor: isLine ? color.replace("0.85", "1") : undefined,
      pointBorderColor: isLine ? "#fff" : undefined,
      pointBorderWidth: isLine ? 2 : undefined,
    };
  });

  const chart = {
    type: input.chart_type,
    data: { labels: input.labels, datasets },
    options: {
      title: { display: true, text: input.title, fontSize: 16, fontStyle: "bold" },
      legend: { display: input.datasets.length > 1 || isCircular, position: "bottom" },
      scales: isCircular ? undefined : {
        yAxes: [{ ticks: { beginAtZero: true } }],
      },
      plugins: {
        datalabels: {
          display: isCircular,
          color: "#fff",
          font: { weight: "bold" },
        },
      },
    },
  };

  const params = new URLSearchParams({
    c: JSON.stringify(chart),
    w: "700",
    h: "400",
    bkg: "white",
    devicePixelRatio: "2",
  });
  return `https://quickchart.io/chart?${params.toString()}`;
}

// ─── Main entry ──────────────────────────────────────────────────────────
// Runs on Lovable AI (Responses API). Name kept so existing callers are unchanged.

export async function callAnthropic(
  messages: ChatMessage[],
  options: AnthropicCallOptions = {},
): Promise<AnthropicResult> {
  const systemFromMessages = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .filter((c) => c && c.trim().length > 0)
    .join("\n\n");
  const instructions = [options.system, systemFromMessages].filter(Boolean).join("\n\n") || undefined;

  const input: any[] = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .filter((m) => m.content && m.content.trim().length > 0)
    .map((m) => m.role === "user"
      ? { role: "user", content: [{ type: "input_text", text: sanitizeString(m.content) }] }
      : { role: "assistant", content: [{ type: "output_text", text: sanitizeString(m.content) }] });
  while (input.length > 0 && input[0].role !== "user") input.shift();
  if (input.length === 0) {
    return { ok: false, status: 400, content: "", charts: [], error: "No user messages provided" };
  }

  const charts: GeneratedChart[] = [];
  const totalUsage: TokenUsage = { input_tokens: 0, output_tokens: 0 };
  const maxRounds = options.maxToolRounds ?? 3;
  const tools = options.enableCharts
    ? [{ type: "function", name: CHART_TOOL.name, description: CHART_TOOL.description, parameters: CHART_TOOL.input_schema, strict: false }]
    : undefined;
  let runId: string | undefined;

  for (let round = 0; round < maxRounds; round++) {
    const r = await streamResponses({ model: options.model, instructions, input, tools, runId });
    runId = r.runId;
    totalUsage.input_tokens += r.usage.input_tokens;
    totalUsage.output_tokens += r.usage.output_tokens;
    if (r.usage.cached_tokens) totalUsage.cache_read_input_tokens = (totalUsage.cache_read_input_tokens || 0) + r.usage.cached_tokens;
    if (!r.ok) return { ok: false, status: r.status, content: "", charts, usage: totalUsage, error: r.error };

    const calls = r.output.filter((o) => o.type === "function_call");
    if (calls.length === 0) {
      if (!r.text.trim()) return { ok: false, status: 502, content: "", charts, usage: totalUsage, error: "AI returned an empty answer" };
      return { ok: true, status: 200, content: r.text, charts, usage: totalUsage };
    }

    input.push(...r.output); // keep reasoning + function_call items paired with their outputs
    for (const c of calls) {
      let out: string;
      if (c.name === "generate_chart") {
        try {
          const args = JSON.parse(c.arguments || "{}");
          const url = buildChartUrl(args);
          charts.push({ url, title: args.title, chart_type: args.chart_type });
          out = `Chart created. URL: ${url}. The user will see this image rendered inline — refer to it naturally (e.g. "see the chart above").`;
        } catch (e) {
          out = `Error generating chart: ${e instanceof Error ? e.message : String(e)}`;
        }
      } else out = `Unknown tool: ${c.name}`;
      input.push({ type: "function_call_output", call_id: c.call_id, output: out });
    }
  }

  return {
    ok: true,
    status: 200,
    content: "I generated the chart(s) above. Let me know if you'd like a different view.",
    charts,
    usage: totalUsage,
  };
}
