import { useQuery } from '@tanstack/react-query';
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
