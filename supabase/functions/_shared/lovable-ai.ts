// Lovable AI Gateway — OpenAI Responses API over raw HTTP, always streamed.
// Every AI call in the edge functions goes through streamResponses().
// Stateless: store=false, prior output items (incl. encrypted reasoning) are resent inline.

export const AI_DEFAULT_MODEL = "openai/gpt-6-astra";
const GATEWAY = "https://ai.gateway.lovable.dev/v1/responses";

export interface ResponsesUsage { input_tokens: number; output_tokens: number; cached_tokens: number }

export interface ResponsesResult {
  ok: boolean;
  status: number;
  output: any[];          // output items as returned (reasoning, message, function_call)
  text: string;
  usage: ResponsesUsage;
  error?: string;
  runId?: string;
}

export interface ResponsesRequest {
  model?: string;
  instructions?: string;
  input: any[];
  tools?: any[];
  toolChoice?: unknown;
  effort?: "low" | "medium" | "high";
  runId?: string;
}

export async function streamResponses(req: ResponsesRequest): Promise<ResponsesResult> {
  const empty = { output: [], text: "", usage: { input_tokens: 0, output_tokens: 0, cached_tokens: 0 } };
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return { ok: false, status: 500, ...empty, error: "LOVABLE_API_KEY is not configured" };

  const body: Record<string, unknown> = {
    model: req.model || AI_DEFAULT_MODEL,
    input: req.input,
    stream: true,
    store: false,
    reasoning: { effort: req.effort ?? "medium", summary: "auto" },
    include: ["reasoning.encrypted_content"],
  };
  if (req.instructions) body.instructions = req.instructions;
  if (req.tools?.length) body.tools = req.tools;
  if (req.toolChoice) body.tool_choice = req.toolChoice;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Lovable-API-Key": apiKey,
    "X-Lovable-AIG-SDK": "fetch",
  };
  if (req.runId) headers["X-Lovable-AIG-Run-ID"] = req.runId;

  let res: Response;
  try {
    res = await fetch(GATEWAY, { method: "POST", headers, body: JSON.stringify(body) });
  } catch (e) {
    return { ok: false, status: 500, ...empty, error: e instanceof Error ? e.message : String(e) };
  }
  const runId = req.runId || res.headers.get("X-Lovable-AIG-Run-ID")?.trim() || undefined;
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => "");
    console.error("Lovable AI error:", res.status, t.slice(0, 500));
    return { ok: false, status: res.status, ...empty, error: t.slice(0, 500) || `HTTP ${res.status}`, runId };
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", text = "", output: any[] = [], usage = empty.usage, error: string | undefined;
  const items: any[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
      const data = chunk.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
      if (!data || data === "[DONE]") continue;
      let ev: any; try { ev = JSON.parse(data); } catch { continue; }
      if (ev.type === "response.output_text.delta") text += ev.delta ?? "";
      else if (ev.type === "response.output_item.done" && ev.item) items.push(ev.item);
      else if (ev.type === "response.completed" || ev.type === "response.incomplete") {
        output = ev.response?.output ?? items;
        const u = ev.response?.usage ?? {};
        usage = { input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0, cached_tokens: u.input_tokens_details?.cached_tokens ?? 0 };
      } else if (ev.type === "response.failed" || ev.type === "error") {
        error = ev.response?.error?.message ?? ev.error?.message ?? ev.message ?? "AI request failed";
      }
    }
  }
  if (!output.length) output = items;
  if (!text) {
    text = output.filter((o) => o.type === "message")
      .flatMap((o) => o.content ?? []).filter((c: any) => c.type === "output_text").map((c: any) => c.text).join("");
  }
  if (error) return { ok: false, status: 502, output, text, usage, error, runId };
  return { ok: true, status: 200, output, text, usage, runId };
}

/** One forced function call; returns the parsed arguments. */
export async function forcedToolCall(opts: {
  prompt: string; tool: { name: string; description?: string; input_schema: any }; effort?: "low" | "medium" | "high";
}): Promise<{ ok: boolean; status: number; args?: any; usage: ResponsesUsage; error?: string; model: string }> {
  const model = AI_DEFAULT_MODEL;
  const r = await streamResponses({
    model,
    effort: opts.effort,
    input: [{ role: "user", content: opts.prompt }],
    tools: [{ type: "function", name: opts.tool.name, description: opts.tool.description ?? "", parameters: opts.tool.input_schema, strict: false }],
    toolChoice: { type: "function", name: opts.tool.name },
  });
  if (!r.ok) return { ok: false, status: r.status, usage: r.usage, error: r.error, model };
  const call = r.output.find((o) => o.type === "function_call" && o.name === opts.tool.name);
  if (!call) return { ok: false, status: 502, usage: r.usage, error: "model returned no tool call", model };
  try { return { ok: true, status: 200, args: JSON.parse(call.arguments || "{}"), usage: r.usage, model }; }
  catch { return { ok: false, status: 502, usage: r.usage, error: "tool call arguments were not valid JSON", model }; }
}
