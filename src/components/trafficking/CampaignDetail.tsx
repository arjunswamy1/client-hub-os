import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBudgetPhases, useCampaignKeywords, useCampaignExtensions } from '@/hooks/useTrafficking';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { BudgetGantt } from './BudgetGantt';

interface Props {
  campaign: any;
  onBack: () => void;
  clientId: string;
}

export function CampaignDetail({ campaign, onBack, clientId }: Props) {
  const { data: phases = [] } = useBudgetPhases(campaign.id);
  const { data: keywords = [] } = useCampaignKeywords(campaign.id);
  const { data: extensions = [] } = useCampaignExtensions(campaign.id);
  const qc = useQueryClient();
  const { toast } = useToast();

  const isGoogle = campaign.platform === 'google';

  // Add budget phase
  const addPhase = async () => {
    const { error } = await supabase.from('campaign_budget_phases').insert({
      campaign_id: campaign.id,
      phase_name: `Phase ${(phases as any[]).length + 1}`,
      position: (phases as any[]).length,
    });
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    else qc.invalidateQueries({ queryKey: ['budget_phases', campaign.id] });
  };

  // Add keyword
  const addKeyword = async (isNeg = false) => {
    const { error } = await supabase.from('campaign_keywords').insert({
      campaign_id: campaign.id,
      ad_group: 'Default',
      keyword: '',
      match_type: 'exact',
      is_negative: isNeg,
    });
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    else qc.invalidateQueries({ queryKey: ['campaign_keywords', campaign.id] });
  };

  // Add extension
  const addExtension = async (type: string) => {
    const { error } = await supabase.from('campaign_extensions').insert({
      campaign_id: campaign.id,
      extension_type: type,
      text: '',
    });
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    else qc.invalidateQueries({ queryKey: ['campaign_extensions', campaign.id] });
  };

  const totalPlanned = (phases as any[]).reduce((sum: number, p: any) => sum + Number(p.phase_total || 0), 0);
  const totalActual = (phases as any[]).reduce((sum: number, p: any) => sum + Number(p.actual_spend || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
        <div>
          <h2 className="text-lg font-semibold">{campaign.name}</h2>
          <p className="text-xs text-muted-foreground">
            {campaign.platform} • {campaign.objective || 'No objective'} •
            {campaign.start_date && campaign.end_date
              ? ` ${format(new Date(campaign.start_date), 'MMM d')} – ${format(new Date(campaign.end_date), 'MMM d, yyyy')}`
              : ' No dates'}
          </p>
        </div>
        <Badge className="ml-auto">{campaign.status}</Badge>
      </div>

      <Tabs defaultValue="budget">
        <TabsList>
          <TabsTrigger value="budget">Budget Phases</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          {isGoogle && <TabsTrigger value="keywords">Keywords</TabsTrigger>}
          {isGoogle && <TabsTrigger value="extensions">Extensions</TabsTrigger>}
        </TabsList>

        <TabsContent value="budget">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">Budget Phases</CardTitle>
              <div className="flex items-center gap-3 text-xs">
                <span>Planned: <strong>${totalPlanned.toLocaleString()}</strong></span>
                <span>Actual: <strong>${totalActual.toLocaleString()}</strong></span>
                <Button size="sm" variant="outline" onClick={addPhase}><Plus className="h-3 w-3 mr-1" /> Add Phase</Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Phase</TableHead>
                    <TableHead>Start</TableHead>
                    <TableHead>End</TableHead>
                    <TableHead className="text-right">Daily Budget</TableHead>
                    <TableHead className="text-right">Phase Total</TableHead>
                    <TableHead className="text-right">% of Total</TableHead>
                    <TableHead className="text-right">Actual Spend</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(phases as any[]).length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No budget phases yet.</TableCell></TableRow>
                  ) : (
                    (phases as any[]).map((phase: any) => (
                      <TableRow key={phase.id}>
                        <TableCell className="font-medium text-sm">{phase.phase_name}</TableCell>
                        <TableCell className="text-xs">{phase.start_date ? format(new Date(phase.start_date), 'MMM d') : '—'}</TableCell>
                        <TableCell className="text-xs">{phase.end_date ? format(new Date(phase.end_date), 'MMM d') : '—'}</TableCell>
                        <TableCell className="text-right text-sm">{phase.daily_budget ? `$${Number(phase.daily_budget).toFixed(2)}` : '—'}</TableCell>
                        <TableCell className="text-right text-sm">{phase.phase_total ? `$${Number(phase.phase_total).toLocaleString()}` : '—'}</TableCell>
                        <TableCell className="text-right text-sm">{phase.percentage_of_total ? `${phase.percentage_of_total}%` : '—'}</TableCell>
                        <TableCell className="text-right text-sm font-medium">{Number(phase.actual_spend) > 0 ? `$${Number(phase.actual_spend).toLocaleString()}` : '—'}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="timeline">
          <Card>
            <CardContent className="pt-6">
              {campaign.start_date && campaign.end_date ? (
                <BudgetGantt campaign={campaign} phases={phases as any[]} />
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">Set campaign start and end dates to see the timeline.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {isGoogle && (
          <TabsContent value="keywords">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm">Keywords</CardTitle>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => addKeyword(false)}><Plus className="h-3 w-3 mr-1" /> Keyword</Button>
                  <Button size="sm" variant="outline" onClick={() => addKeyword(true)}><Plus className="h-3 w-3 mr-1" /> Negative</Button>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ad Group</TableHead>
                      <TableHead>Keyword</TableHead>
                      <TableHead>Match Type</TableHead>
                      <TableHead>Intent</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>QS</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(keywords as any[]).length === 0 ? (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No keywords yet.</TableCell></TableRow>
                    ) : (
                      (keywords as any[]).map((kw: any) => (
                        <TableRow key={kw.id}>
                          <TableCell className="text-sm">{kw.ad_group}</TableCell>
                          <TableCell className="text-sm font-medium">{kw.keyword || <span className="text-muted-foreground italic">empty</span>}</TableCell>
                          <TableCell><Badge variant="outline" className="text-[10px]">{kw.match_type || '—'}</Badge></TableCell>
                          <TableCell className="text-xs">{kw.intent || '—'}</TableCell>
                          <TableCell>{kw.is_negative ? <Badge className="bg-red-100 text-red-800 text-[10px]">Negative</Badge> : <Badge className="bg-green-100 text-green-800 text-[10px]">Positive</Badge>}</TableCell>
                          <TableCell className="text-xs">{kw.quality_score || '—'}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {isGoogle && (
          <TabsContent value="extensions">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm">Ad Extensions</CardTitle>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => addExtension('sitelink')}>+ Sitelink</Button>
                  <Button size="sm" variant="outline" onClick={() => addExtension('callout')}>+ Callout</Button>
                  <Button size="sm" variant="outline" onClick={() => addExtension('structured_snippet')}>+ Snippet</Button>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Text</TableHead>
                      <TableHead>Description / Values</TableHead>
                      <TableHead>URL</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(extensions as any[]).length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No extensions yet.</TableCell></TableRow>
                    ) : (
                      (extensions as any[]).map((ext: any) => (
                        <TableRow key={ext.id}>
                          <TableCell><Badge variant="outline" className="text-[10px]">{ext.extension_type}</Badge></TableCell>
                          <TableCell className="text-sm">{ext.text || '—'}</TableCell>
                          <TableCell className="text-xs">{ext.description || ext.values_text || '—'}</TableCell>
                          <TableCell className="text-xs truncate max-w-[200px]">{ext.url || '—'}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
