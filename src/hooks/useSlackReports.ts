import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ReportScope = "buyology" | "rrm" | "jacuzzi";

export interface SlackReport {
  id: string;
  client_id: string;
  scope: string;
  enabled: boolean;
  slack_channel_id: string | null;
  slack_channel_name: string | null;
  day_of_week: number;
  run_hour_utc: number;
  notes: string | null;
  last_sent_at: string | null;
  last_period_key: string | null;
  last_error: string | null;
}

export interface SlackChannel {
  id: string;
  name: string;
  is_private?: boolean;
}

/** Slack channels the bot is a member of. */
export function useSlackChannels() {
  return useQuery({
    queryKey: ["slack-channels"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("sync-slack", { body: { action: "list_channels" } });
      if (error) throw error;
      return ((data as any)?.channels || []) as SlackChannel[];
    },
    staleTime: 10 * 60 * 1000,
  });
}

export function useSlackReport(clientId: string, scope: ReportScope) {
  return useQuery({
    queryKey: ["slack-report", clientId, scope],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_slack_reports")
        .select("*")
        .eq("client_id", clientId)
        .eq("scope", scope)
        .maybeSingle();
      if (error) throw error;
      return (data as SlackReport | null) ?? null;
    },
  });
}

export function useSaveSlackReport(clientId: string, scope: ReportScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<SlackReport>) => {
      const { data, error } = await supabase
        .from("client_slack_reports")
        .upsert({ client_id: clientId, scope, ...patch } as any, { onConflict: "client_id,scope" })
        .select("*")
        .single();
      if (error) throw error;
      return data as SlackReport;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["slack-report", clientId, scope] }),
  });
}

/** Generate and post the brief right now (same code path as the Monday run). */
export function useSendSlackReportNow(clientId: string, scope: ReportScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("weekly-slack-reports", {
        body: { client_id: clientId, scope },
      });
      if (error) {
        const details = (error as any)?.context?.text ? await (error as any).context.text() : error.message;
        throw new Error(details);
      }
      const res = data as { success?: boolean; sent?: number; error?: string };
      if (res?.error) throw new Error(res.error);
      return res;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["slack-report", clientId, scope] }),
  });
}
