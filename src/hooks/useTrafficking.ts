import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

// ── Content Calendar ──
export function useContentCalendar(clientId: string | null) {
  return useQuery({
    queryKey: ['content_calendar', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('content_calendar_entries')
        .select('*, created_by:team_members!content_calendar_entries_created_by_id_fkey(name)')
        .eq('client_id', clientId!)
        .order('week_of', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!clientId,
  });
}

export function useContentCalendarMutations(clientId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const upsertEntry = useMutation({
    mutationFn: async (entry: any) => {
      const { error } = await supabase.from('content_calendar_entries').upsert(entry);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['content_calendar', clientId] }); },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const deleteEntry = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('content_calendar_entries').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['content_calendar', clientId] }); },
  });

  return { upsertEntry, deleteEntry };
}

// ── Campaigns ──
export function useCampaigns(clientId: string | null) {
  return useQuery({
    queryKey: ['trafficking_campaigns', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trafficking_campaigns')
        .select('*')
        .eq('client_id', clientId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!clientId,
  });
}

export function useCampaignMutations(clientId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const createCampaign = useMutation({
    mutationFn: async (campaign: any) => {
      const { data, error } = await supabase.from('trafficking_campaigns').insert({ ...campaign, client_id: clientId }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trafficking_campaigns', clientId] });
      toast({ title: 'Campaign created' });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const updateCampaign = useMutation({
    mutationFn: async ({ id, ...updates }: any) => {
      const { error } = await supabase.from('trafficking_campaigns').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['trafficking_campaigns', clientId] }); },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  return { createCampaign, updateCampaign };
}

// ── Budget Phases ──
export function useBudgetPhases(campaignId: string | null) {
  return useQuery({
    queryKey: ['budget_phases', campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('campaign_budget_phases')
        .select('*')
        .eq('campaign_id', campaignId!)
        .order('position');
      if (error) throw error;
      return data || [];
    },
    enabled: !!campaignId,
  });
}

// ── Keywords ──
export function useCampaignKeywords(campaignId: string | null) {
  return useQuery({
    queryKey: ['campaign_keywords', campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('campaign_keywords')
        .select('*')
        .eq('campaign_id', campaignId!)
        .order('ad_group');
      if (error) throw error;
      return data || [];
    },
    enabled: !!campaignId,
  });
}

// ── Extensions ──
export function useCampaignExtensions(campaignId: string | null) {
  return useQuery({
    queryKey: ['campaign_extensions', campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('campaign_extensions')
        .select('*')
        .eq('campaign_id', campaignId!);
      if (error) throw error;
      return data || [];
    },
    enabled: !!campaignId,
  });
}

// ── Trafficking Ads ──
export function useTraffickingAds(clientId: string | null, statusFilter?: string[]) {
  return useQuery({
    queryKey: ['trafficking_ads', clientId, statusFilter],
    queryFn: async () => {
      let query = supabase
        .from('trafficking_ads')
        .select(`
          *,
          campaign:trafficking_campaigns(name, platform),
          brief:creative_briefs(title),
          created_by:team_members!trafficking_ads_created_by_id_fkey(name),
          approved_by:team_members!trafficking_ads_approved_by_id_fkey(name)
        `)
        .eq('client_id', clientId!)
        .order('created_at', { ascending: false });

      if (statusFilter && statusFilter.length > 0) {
        query = query.in('status', statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: !!clientId,
  });
}

export function useTraffickingAdMutations(clientId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const createAd = useMutation({
    mutationFn: async (ad: any) => {
      const { data, error } = await supabase.from('trafficking_ads').insert({ ...ad, client_id: clientId }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trafficking_ads', clientId] });
      toast({ title: 'Ad created' });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const updateAd = useMutation({
    mutationFn: async ({ id, ...updates }: any) => {
      const { error } = await supabase.from('trafficking_ads').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trafficking_ads', clientId] });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const deleteAd = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('trafficking_ads').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trafficking_ads', clientId] });
      toast({ title: 'Ad deleted' });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  return { createAd, updateAd, deleteAd };
}

// ── Default Launch Checklist ──
export const DEFAULT_LAUNCH_CHECKLIST = [
  { item: 'Creative assets approved by AM', required: true },
  { item: 'Ad copy reviewed and finalized', required: true },
  { item: 'Landing page URL tested', required: true },
  { item: 'UTM parameters configured', required: true },
  { item: 'Pixel/conversion tracking verified', required: true },
  { item: 'Budget confirmed and within campaign plan', required: true },
  { item: 'Audience/targeting configured correctly', required: true },
  { item: 'Preview link generated and reviewed', required: true },
  { item: 'Client approval received', required: false },
  { item: 'Ad naming convention followed', required: true },
  { item: 'Campaign start/end dates correct', required: true },
];
