import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type DIDPlatform = "roku" | "universal" | "google_demand_gen";
export type DIDStatus = "active" | "paused" | "not_in_use";

export interface ClientDID {
  id: string;
  client_id: string;
  did: string;
  did_formatted: string | null;
  platform: DIDPlatform | null;
  creative_name: string | null;
  audience_cluster: string | null;
  campaign_name: string | null;
  ad_length: string | null;
  targeting_notes: string | null;
  status: DIDStatus;
  notes: string | null;
  assigned_at: string;
  updated_at: string;
}

export interface ClientDIDHistory {
  id: string;
  did_id: string;
  platform: string | null;
  creative_name: string | null;
  audience_cluster: string | null;
  campaign_name: string | null;
  ad_length: string | null;
  status: string | null;
  changed_at: string;
  changed_by_id: string | null;
}

export const PLATFORM_LABELS: Record<DIDPlatform, string> = {
  roku: "Roku",
  universal: "Universal",
  google_demand_gen: "Google Demand Gen",
};

/** Normalize phone input to E.164 (+1XXXXXXXXXX) and a display format. */
export function normalizeDid(input: string): { e164: string; formatted: string } {
  const digits = input.replace(/\D/g, "");
  // Strip leading 1 if 11 digits, then pad
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) {
    // Return whatever we have — caller can validate
    return { e164: `+${digits}`, formatted: input };
  }
  return {
    e164: `+1${ten}`,
    formatted: `1-${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}`,
  };
}

export function useClientDids(clientId: string | undefined) {
  return useQuery({
    queryKey: ["client-dids", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_dids")
        .select("*")
        .eq("client_id", clientId!)
        .order("did", { ascending: true });
      if (error) throw error;
      return (data || []) as ClientDID[];
    },
  });
}

export function useDidHistory(didId: string | undefined) {
  return useQuery({
    queryKey: ["did-history", didId],
    enabled: !!didId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_did_history")
        .select("*")
        .eq("did_id", didId!)
        .order("changed_at", { ascending: false });
      if (error) throw error;
      return (data || []) as ClientDIDHistory[];
    },
  });
}

export function useUpsertDid(clientId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: Partial<ClientDID> & { did: string; id?: string }
    ) => {
      if (!clientId) throw new Error("No client selected");
      const { e164, formatted } = normalizeDid(input.did);
      const payload: any = {
        client_id: clientId,
        did: e164,
        did_formatted: input.did_formatted ?? formatted,
        platform: input.platform ?? null,
        creative_name: input.creative_name ?? null,
        audience_cluster: input.audience_cluster ?? null,
        campaign_name: input.campaign_name ?? null,
        ad_length: input.ad_length ?? null,
        targeting_notes: input.targeting_notes ?? null,
        status: input.status ?? "active",
        notes: input.notes ?? null,
      };
      if (input.id) {
        const { error } = await supabase
          .from("client_dids")
          .update(payload)
          .eq("id", input.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("client_dids").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["client-dids", clientId] });
      toast.success("DID saved");
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to save DID"),
  });
}

export function useDeleteDid(clientId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("client_dids").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["client-dids", clientId] });
      toast.success("DID deleted");
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to delete DID"),
  });
}
