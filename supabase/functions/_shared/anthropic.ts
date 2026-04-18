// Shared Anthropic Claude client for edge functions
// Converts OpenAI-style messages -> Anthropic Messages API

export const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

export interface ChatMessage {
  role: string;
  content: string;
}

export interface AnthropicCallOptions {
  model?: string;
  max_tokens?: number;
  temperature?: number;
  system?: string;
}

export interface AnthropicResult {
  ok: boolean;
  status: number;
  content: string;
  error?: string;
}

/**
 * Call Anthropic Claude with OpenAI-style messages.
 * - Extracts system messages and joins them into the top-level `system` param.
 * - Maps `assistant`/`user` roles directly. Drops empty messages.
 * - Returns a normalized result with the assistant text content.
 */
export async function callAnthropic(
  messages: ChatMessage[],
  options: AnthropicCallOptions = {},
): Promise<AnthropicResult> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return { ok: false, status: 500, content: "", error: "ANTHROPIC_API_KEY is not configured" };
  }

  const systemFromMessages = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .filter((c) => c && c.trim().length > 0)
    .join("\n\n");

  const system = [options.system, systemFromMessages].filter(Boolean).join("\n\n") || undefined;

  const conversation = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .filter((m) => m.content && m.content.trim().length > 0)
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  // Anthropic requires the conversation to start with a user message.
  while (conversation.length > 0 && conversation[0].role !== "user") {
    conversation.shift();
  }

  if (conversation.length === 0) {
    return { ok: false, status: 400, content: "", error: "No user messages provided" };
  }

  const body: Record<string, unknown> = {
    model: options.model || ANTHROPIC_DEFAULT_MODEL,
    max_tokens: options.max_tokens ?? 2048,
    messages: conversation,
  };
  if (system) body.system = system;
  if (options.temperature !== undefined) body.temperature = options.temperature;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Anthropic error:", res.status, errText.slice(0, 500));
      return { ok: false, status: res.status, content: "", error: errText.slice(0, 500) };
    }

    const data = await res.json();
    // Anthropic returns content as an array of blocks; concatenate text blocks.
    const text = Array.isArray(data.content)
      ? data.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("")
      : "";
    return { ok: true, status: 200, content: text };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Anthropic fetch exception:", message);
    return { ok: false, status: 500, content: "", error: message };
  }
}
