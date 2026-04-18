// Shared Anthropic Claude client for edge functions
// - Converts OpenAI-style messages -> Anthropic Messages API
// - Supports tool calling with a built-in `generate_chart` tool that returns
//   a QuickChart.io PNG URL Claude can reference, and that callers can
//   surface in their UI (web chat, Slack uploads, etc.)

export const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

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

export interface AnthropicResult {
  ok: boolean;
  status: number;
  content: string;
  charts: GeneratedChart[];
  error?: string;
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

export async function callAnthropic(
  messages: ChatMessage[],
  options: AnthropicCallOptions = {},
): Promise<AnthropicResult> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return { ok: false, status: 500, content: "", charts: [], error: "ANTHROPIC_API_KEY is not configured" };
  }

  const systemFromMessages = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .filter((c) => c && c.trim().length > 0)
    .join("\n\n");

  const system = [options.system, systemFromMessages].filter(Boolean).join("\n\n") || undefined;

  // Anthropic conversation must start with user; map roles & drop empties.
  const conversation: any[] = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .filter((m) => m.content && m.content.trim().length > 0)
    .map((m) => ({ role: m.role, content: m.content }));

  while (conversation.length > 0 && conversation[0].role !== "user") {
    conversation.shift();
  }

  if (conversation.length === 0) {
    return { ok: false, status: 400, content: "", charts: [], error: "No user messages provided" };
  }

  const charts: GeneratedChart[] = [];
  const maxRounds = options.maxToolRounds ?? 3;

  for (let round = 0; round < maxRounds; round++) {
    const body: Record<string, unknown> = {
      model: options.model || ANTHROPIC_DEFAULT_MODEL,
      max_tokens: options.max_tokens ?? 2048,
      messages: conversation,
    };
    if (system) body.system = system;
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.enableCharts) body.tools = [CHART_TOOL];

    let res: Response;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(sanitizeForJson(body)),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("Anthropic fetch exception:", message);
      return { ok: false, status: 500, content: "", charts, error: message };
    }

    if (!res.ok) {
      const errText = await res.text();
      console.error("Anthropic error:", res.status, errText.slice(0, 500));
      return { ok: false, status: res.status, content: "", charts, error: errText.slice(0, 500) };
    }

    const data = await res.json();
    const blocks: any[] = Array.isArray(data.content) ? data.content : [];
    const textOut = blocks.filter((b) => b.type === "text").map((b) => b.text).join("");
    const toolUses = blocks.filter((b) => b.type === "tool_use");

    // No tool calls — we're done.
    if (toolUses.length === 0 || data.stop_reason !== "tool_use") {
      return { ok: true, status: 200, content: textOut, charts };
    }

    // Echo assistant turn back into the conversation, then add tool_results.
    conversation.push({ role: "assistant", content: blocks });

    const toolResults: any[] = [];
    for (const tu of toolUses) {
      if (tu.name === "generate_chart") {
        try {
          const input = tu.input as {
            title: string;
            chart_type: string;
            labels: string[];
            datasets: { label: string; data: number[] }[];
          };
          const url = buildChartUrl(input);
          charts.push({ url, title: input.title, chart_type: input.chart_type });
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: `Chart created. URL: ${url}. The user will see this image rendered inline — refer to it naturally (e.g. "see the chart above").`,
          });
        } catch (e) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: `Error generating chart: ${e instanceof Error ? e.message : String(e)}`,
            is_error: true,
          });
        }
      } else {
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: `Unknown tool: ${tu.name}`,
          is_error: true,
        });
      }
    }

    conversation.push({ role: "user", content: toolResults });
  }

  // Hit max rounds without final text.
  return {
    ok: true,
    status: 200,
    content: "I generated the chart(s) above. Let me know if you'd like a different view.",
    charts,
  };
}
