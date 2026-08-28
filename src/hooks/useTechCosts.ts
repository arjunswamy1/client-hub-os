import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface DailyUsageRow {
  client_id: string | null;
  date: string;
  category: string;
  service: string;
  total_input_tokens: number;
  total_output_tokens: number;
  total_quantity: number;
  event_count: number;
  total_cost_usd: number;
}

export interface UsageEvent {
  id: string;
  client_id: string | null;
  category: string;
  service: string;
  surface: string | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  quantity: number;
  unit: string;
  cost_usd: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export function useTechUsageDaily(startDate: string, endDate: string, clientId?: string) {
  return useQuery({
    queryKey: ['tech-usage-daily', startDate, endDate, clientId ?? 'all'],
    queryFn: async () => {
      let q = supabase
        .from('tech_usage_daily')
        .select('client_id, date, category, service, total_input_tokens, total_output_tokens, total_quantity, event_count, total_cost_usd')
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true });
      if (clientId) q = q.eq('client_id', clientId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as DailyUsageRow[];
    },
  });
}

export function useTechUsageEvents(clientId: string, startDate: string, endDate: string, limit = 200) {
  return useQuery({
    queryKey: ['tech-usage-events', clientId, startDate, endDate, limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tech_usage_events')
        .select('id, client_id, category, service, surface, model, input_tokens, output_tokens, quantity, unit, cost_usd, metadata, created_at')
        .eq('client_id', clientId)
        .gte('created_at', `${startDate}T00:00:00Z`)
        .lte('created_at', `${endDate}T23:59:59Z`)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as UsageEvent[];
    },
    enabled: !!clientId,
  });
}

export function useClientsBasic() {
  return useQuery({
    queryKey: ['clients-basic'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, name, slug, color')
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });
}

// ---------------------------------------------------------------------------
// Lovable credit allocations from other workspace projects
// ---------------------------------------------------------------------------

export interface ExternalProject {
  id: string;
  project_name: string;
  client_id: string | null;
  notes: string | null;
}

export interface CreditAllocation {
  id: string;
  project_name: string;
  client_id: string | null;
  date: string;
  credits: number;
  cost_usd: number;
  note: string | null;
}

export function useExternalProjects() {
  return useQuery({
    queryKey: ['tech-external-projects'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tech_external_projects')
        .select('id, project_name, client_id, notes')
        .order('project_name');
      if (error) throw error;
      return (data ?? []) as ExternalProject[];
    },
  });
}

export function useCreditAllocations(startDate: string, endDate: string, clientId?: string) {
  return useQuery({
    queryKey: ['tech-credit-allocations', startDate, endDate, clientId ?? 'all'],
    queryFn: async () => {
      let q = supabase
        .from('tech_credit_allocations')
        .select('id, project_name, client_id, date, credits, cost_usd, note')
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: false });
      if (clientId) q = q.eq('client_id', clientId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as CreditAllocation[];
    },
  });
}

export function useSaveExternalProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id?: string; project_name: string; client_id: string | null; notes?: string | null }) => {
      if (input.id) {
        const { error } = await supabase
          .from('tech_external_projects')
          .update({ project_name: input.project_name, client_id: input.client_id, notes: input.notes ?? null })
          .eq('id', input.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('tech_external_projects')
          .insert({ project_name: input.project_name, client_id: input.client_id, notes: input.notes ?? null });
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tech-external-projects'] }),
  });
}

export function useDeleteExternalProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('tech_external_projects').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tech-external-projects'] }),
  });
}

export function useSaveCreditAllocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      project_name: string;
      client_id: string | null;
      date: string;
      credits: number;
      cost_usd: number;
      note?: string | null;
    }) => {
      const { error } = await supabase.from('tech_credit_allocations').insert(input);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tech-credit-allocations'] }),
  });
}

export function useDeleteCreditAllocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('tech_credit_allocations').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tech-credit-allocations'] }),
  });
}
