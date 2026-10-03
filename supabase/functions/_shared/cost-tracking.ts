// Shared cost tracking utility for edge functions.
// Logs technology usage events (AI tokens, integration calls, storage, email)
// to tech_usage_events with auto-computed USD cost.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

let _client: ReturnType<typeof createClient> | null = null;

function getClient() {
  if (_client) return _client;
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  _client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

export interface AiUsageInput {
  client_id?: string | null;
  surface: string; // 'ai-assistant' | 'slack-ai-bot'
  model: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  metadata?: Record<string, unknown>;
}

export interface IntegrationUsageInput {
  client_id?: string | null;
  service: string; // 'meta_api' | 'google_api' | 'ringba_api' | 'fathom_api' | 'slack_api'
  surface?: string;
  calls?: number;
  metadata?: Record<string, unknown>;
}

export interface StorageUsageInput {
  client_id?: string | null;
  service: string; // 'supabase'
  bytes: number;
  metadata?: Record<string, unknown>;
}

export interface EmailUsageInput {
  client_id?: string | null;
  service?: string; // 'resend'
  emails?: number;
  metadata?: Record<string, unknown>;
}

export interface MediaGenUsageInput {
  client_id?: string | null;
  service: string; // 'google_veo' | 'elevenlabs'
  surface: string; // 'ai-video-studio' etc.
  model: string;  // 'veo-3.1-generate-preview' | 'eleven_multilingual_v2' | 'music'
  unit: 'seconds' | 'characters';
  quantity: number;
  metadata?: Record<string, unknown>;
}

async function computeCost(params: {
  service: string;
  model: string | null;
  unit: string;
  quantity?: number;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
}): Promise<number> {
  try {
    const { data, error } = await getClient().rpc("compute_tech_cost", {
      p_service: params.service,
      p_model: params.model,
      p_unit: params.unit,
      p_quantity: params.quantity ?? 0,
      p_input_tokens: params.input_tokens ?? 0,
      p_output_tokens: params.output_tokens ?? 0,
      p_cache_read_tokens: params.cache_read_tokens ?? 0,
      p_cache_write_tokens: params.cache_write_tokens ?? 0,
    });
    if (error) {
      console.error("[cost-tracking] compute error:", error.message);
      return 0;
    }
    return Number(data) || 0;
  } catch (e) {
    console.error("[cost-tracking] compute exception:", e instanceof Error ? e.message : e);
    return 0;
  }
}

async function insertEvent(row: Record<string, unknown>) {
  try {
    const { error } = await getClient().from("tech_usage_events").insert(row);
    if (error) console.error("[cost-tracking] insert error:", error.message);
  } catch (e) {
    console.error("[cost-tracking] insert exception:", e instanceof Error ? e.message : e);
  }
}

export async function logAiUsage(input: AiUsageInput): Promise<void> {
  const inputTokens = input.input_tokens ?? 0;
  const outputTokens = input.output_tokens ?? 0;
  const cacheRead = input.cache_read_tokens ?? 0;
  const cacheWrite = input.cache_write_tokens ?? 0;

  if (inputTokens === 0 && outputTokens === 0) return;

  const service = input.model.includes("/") ? "lovable_ai" : input.model.startsWith("gpt") ? "openai" : "anthropic";

  const cost = await computeCost({
    service,
    model: input.model,
    unit: "input_tokens",
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_tokens: cacheRead,
    cache_write_tokens: cacheWrite,
  });

  await insertEvent({
    client_id: input.client_id ?? null,
    category: "ai",
    service,
    surface: input.surface,
    model: input.model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_tokens: cacheRead,
    cache_write_tokens: cacheWrite,
    quantity: 1,
    unit: "calls",
    cost_usd: cost,
    metadata: input.metadata ?? {},
  });
}

export async function logIntegrationCall(input: IntegrationUsageInput): Promise<void> {
  const calls = input.calls ?? 1;
  const cost = await computeCost({
    service: input.service,
    model: null,
    unit: "calls",
    quantity: calls,
  });

  await insertEvent({
    client_id: input.client_id ?? null,
    category: "integration",
    service: input.service,
    surface: input.surface ?? "cron",
    quantity: calls,
    unit: "calls",
    cost_usd: cost,
    metadata: input.metadata ?? {},
  });
}

export async function logStorageBytes(input: StorageUsageInput): Promise<void> {
  const gbMonth = input.bytes / (1024 ** 3);
  const cost = await computeCost({
    service: input.service,
    model: null,
    unit: "gb_month",
    quantity: gbMonth,
  });

  await insertEvent({
    client_id: input.client_id ?? null,
    category: "storage",
    service: input.service,
    quantity: gbMonth,
    unit: "gb_month",
    cost_usd: cost,
    metadata: input.metadata ?? {},
  });
}

export async function logEmailSend(input: EmailUsageInput): Promise<void> {
  const service = input.service ?? "resend";
  const emails = input.emails ?? 1;
  const cost = await computeCost({
    service,
    model: null,
    unit: "emails",
    quantity: emails,
  });

  await insertEvent({
    client_id: input.client_id ?? null,
    category: "email",
    service,
    quantity: emails,
    unit: "emails",
    cost_usd: cost,
    metadata: input.metadata ?? {},
  });
}

export async function logMediaGenUsage(input: MediaGenUsageInput): Promise<void> {
  if (!input.quantity || input.quantity <= 0) return;
  const cost = await computeCost({
    service: input.service,
    model: input.model,
    unit: input.unit,
    quantity: input.quantity,
  });
  await insertEvent({
    client_id: input.client_id ?? null,
    category: "ai",
    service: input.service,
    surface: input.surface,
    model: input.model,
    quantity: input.quantity,
    unit: input.unit,
    cost_usd: cost,
    metadata: input.metadata ?? {},
  });
}
