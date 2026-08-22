import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ProductLine } from "@/lib/buyologyProductLines";
import { OptimizerPlan } from "@/lib/buyologyOptimizerPdf";

export type Cadence = "daily" | "weekly";

export interface OptimizerSchedule {
  id: string;
  client_id: string;
  scope: string;
  enabled: boolean;
  cadence: Cadence;
  run_hour_utc: number;
  product_lines: string[];
  notes: string | null;
  status: "active" | "paused";
  pause_reason: string | null;
  last_run_at: string | null;
  last_error: string | null;
  next_run_at: string | null;
}

export interface OptimizerBrief {
  id: string;
  product_line: ProductLine;
  line_label: string | null;
  range_label: string | null;
  source: "manual" | "scheduled";
  plan: OptimizerPlan;
  totals: Record<string, number>;
  attribution_rate: number | null;
  period_key: string;
  generated_at: string;
}

/** Schedule row for a client's optimizer (one per client + scope). */
export function useOptimizerSchedule(clientId: string, scope = "buyology") {
  return useQuery({
    queryKey: ["optimizer-schedule", clientId, scope],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_optimizer_schedules")
        .select("*")
        .eq("client_id", clientId)
        .eq("scope", scope)
        .maybeSingle();
      if (error) throw error;
      return (data as OptimizerSchedule | null) ?? null;
    },
  });
}

export function useSaveOptimizerSchedule(clientId: string, scope = "buyology") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<OptimizerSchedule>) => {
      const { data, error } = await supabase
        .from("ai_optimizer_schedules")
        .upsert(
          { client_id: clientId, scope, ...patch } as any,
          { onConflict: "client_id,scope" }
        )
        .select("*")
        .single();
      if (error) throw error;
      return data as OptimizerSchedule;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["optimizer-schedule", clientId, scope] }),
  });
}

/** Stored briefs, newest first, for date-over-date comparison. */
export function useOptimizerBriefs(clientId: string, scope = "buyology") {
  return useQuery({
    queryKey: ["optimizer-briefs", clientId, scope],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_optimizer_briefs")
        .select("id, product_line, line_label, range_label, source, plan, totals, attribution_rate, period_key, generated_at")
        .eq("client_id", clientId)
        .eq("scope", scope)
        .order("generated_at", { ascending: false })
        .limit(60);
      if (error) throw error;
      return (data || []) as unknown as OptimizerBrief[];
    },
  });
}
