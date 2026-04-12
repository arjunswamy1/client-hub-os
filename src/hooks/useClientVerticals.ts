import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useClient } from "@/contexts/ClientContext";
import { VerticalConfig } from "@/config/billyVerticals";
import { toast } from "sonner";

interface DBVertical {
  id: string;
  client_id: string;
  vertical_id: string;
  label: string;
  emoji: string;
  meta_patterns: string[];
  meta_account_ids: string[];
  google_patterns: string[];
  google_account_ids: string[];
  ringba_patterns: string[];
  ringba_exact_match: boolean;
  position: number;
}

function dbToConfig(row: DBVertical): VerticalConfig {
  return {
    id: row.vertical_id,
    label: row.label,
    emoji: row.emoji,
    meta: {
      patterns: row.meta_patterns,
      accountIds: row.meta_account_ids.length > 0 ? row.meta_account_ids : undefined,
    },
    google: {
      patterns: row.google_patterns,
      accountIds: row.google_account_ids.length > 0 ? row.google_account_ids : undefined,
    },
    ringba: {
      patterns: row.ringba_patterns,
      exactMatch: row.ringba_exact_match || undefined,
    },
  };
}

export interface NewVerticalInput {
  label: string;
  emoji: string;
  metaPatterns: string[];
  metaAccountIds: string[];
  googlePatterns: string[];
  googleAccountIds: string[];
  ringbaPatterns: string[];
  ringbaExactMatch: boolean;
}

export function useClientVerticals() {
  const { activeClient } = useClient();
  const queryClient = useQueryClient();
  const clientId = activeClient?.id;

  const { data: dbVerticals = [], isLoading } = useQuery({
    queryKey: ["client-verticals", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_verticals")
        .select("*")
        .eq("client_id", clientId!)
        .order("position");
      if (error) throw error;
      return (data as unknown as DBVertical[]).map(dbToConfig);
    },
  });

  const addVertical = useMutation({
    mutationFn: async (input: NewVerticalInput) => {
      if (!clientId) throw new Error("No client selected");
      const verticalId = input.label.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      
      const { error } = await supabase.from("client_verticals").insert({
        client_id: clientId,
        vertical_id: verticalId,
        label: input.label,
        emoji: input.emoji,
        meta_patterns: input.metaPatterns,
        meta_account_ids: input.metaAccountIds,
        google_patterns: input.googlePatterns,
        google_account_ids: input.googleAccountIds,
        ringba_patterns: input.ringbaPatterns,
        ringba_exact_match: input.ringbaExactMatch,
        position: dbVerticals.length + 10,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client-verticals", clientId] });
      toast.success("Vertical added");
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to add vertical");
    },
  });

  const deleteVertical = useMutation({
    mutationFn: async (verticalId: string) => {
      if (!clientId) throw new Error("No client selected");
      const { error } = await supabase
        .from("client_verticals")
        .delete()
        .eq("client_id", clientId)
        .eq("vertical_id", verticalId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client-verticals", clientId] });
      toast.success("Vertical removed");
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to remove vertical");
    },
  });

  return { dbVerticals, isLoading, addVertical, deleteVertical };
}
