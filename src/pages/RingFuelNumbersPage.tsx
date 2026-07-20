import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useClient } from '@/contexts/ClientContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Loader2, Copy, Plus } from 'lucide-react';

type RingFuelCampaign = {
  label: string;
  ringfuel_campaign_id: string;
  dni_replacement: string;
};

// Per-client campaign config. Extend as more publishers are added.
const CLIENT_CAMPAIGNS: Record<string, RingFuelCampaign[]> = {
  calltofic: [
    {
      label: 'FE CTV - 30s',
      ringfuel_campaign_id: '5a822044-7687-41fb-a940-72832742a773',
      dni_replacement: '+18884387018',
    },
    {
      label: 'FE CTV - RTB',
      ringfuel_campaign_id: 'f8745f86-e505-40b3-86ef-fdb1fbfdeb45',
      dni_replacement: '+18886619018',
    },
  ],
};

function formatPhone(e164: string): string {
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

export default function RingFuelNumbersPage() {
  const { clients, activeClient, setActiveClient } = useClient();
  const qc = useQueryClient();

  const ringfuelClients = useMemo(
    () => clients.filter((c) => CLIENT_CAMPAIGNS[c.slug]),
    [clients]
  );

  const client = activeClient && CLIENT_CAMPAIGNS[activeClient.slug]
    ? activeClient
    : ringfuelClients[0] ?? null;

  const campaigns = client ? CLIENT_CAMPAIGNS[client.slug] ?? [] : [];

  const [selectedCampaignId, setSelectedCampaignId] = useState<string>(campaigns[0]?.ringfuel_campaign_id ?? '');
  const [creativeLabel, setCreativeLabel] = useState('');
  const [minting, setMinting] = useState(false);
  const [bulkCount, setBulkCount] = useState(10);

  const activeCampaign = campaigns.find((c) => c.ringfuel_campaign_id === selectedCampaignId) ?? campaigns[0];

  const { data: numbers = [], isLoading } = useQuery({
    queryKey: ['ringfuel_numbers', client?.id],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ringfuel_numbers')
        .select('*')
        .eq('client_id', client!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  async function mintOne(label: string) {
    if (!client || !activeCampaign) return null;
    const { data, error } = await supabase.functions.invoke('ringfuel-mint-number', {
      body: {
        client_id: client.id,
        client_slug: client.slug,
        campaign_label: activeCampaign.label,
        ringfuel_campaign_id: activeCampaign.ringfuel_campaign_id,
        creative_label: label,
        tags: { creative: label },
      },
    });
    if (error) throw error;
    if ((data as any)?.error) throw new Error((data as any).error);
    return data;
  }

  async function handleMint() {
    if (!creativeLabel.trim()) { toast.error('Enter a creative label'); return; }
    setMinting(true);
    try {
      await mintOne(creativeLabel.trim());
      toast.success(`Minted number for "${creativeLabel}"`);
      setCreativeLabel('');
      qc.invalidateQueries({ queryKey: ['ringfuel_numbers', client?.id] });
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to mint');
    } finally {
      setMinting(false);
    }
  }

  async function handleBulkMint() {
    if (!activeCampaign) return;
    setMinting(true);
    let ok = 0;
    let fail = 0;
    for (let i = 1; i <= bulkCount; i++) {
      const label = `${activeCampaign.label} — Creative ${i}`;
      try {
        await mintOne(label);
        ok++;
      } catch {
        fail++;
      }
    }
    toast[fail ? 'warning' : 'success'](`Minted ${ok}/${bulkCount}${fail ? ` (${fail} failed)` : ''}`);
    qc.invalidateQueries({ queryKey: ['ringfuel_numbers', client?.id] });
    setMinting(false);
  }

  if (ringfuelClients.length === 0) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        No RingFuel-configured clients yet.
      </div>
    );
  }

  const numbersByCampaign = campaigns.map((c) => ({
    campaign: c,
    rows: numbers.filter((n: any) => n.ringfuel_campaign_id === c.ringfuel_campaign_id),
  }));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">RingFuel Tracking Numbers</h1>
          <p className="text-sm text-muted-foreground">
            Mint unique tracking numbers per creative from your RingFuel campaigns.
          </p>
        </div>
        <Select
          value={client?.id ?? ''}
          onValueChange={(id) => {
            const next = ringfuelClients.find((c) => c.id === id);
            if (next) setActiveClient(next);
          }}
        >
          <SelectTrigger className="w-48"><SelectValue placeholder="Client" /></SelectTrigger>
          <SelectContent>
            {ringfuelClients.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="p-4 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="text-xs font-medium text-muted-foreground">Campaign</label>
            <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
              <SelectTrigger><SelectValue placeholder="Campaign" /></SelectTrigger>
              <SelectContent>
                {campaigns.map((c) => (
                  <SelectItem key={c.ringfuel_campaign_id} value={c.ringfuel_campaign_id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[220px]">
            <label className="text-xs font-medium text-muted-foreground">Creative label</label>
            <Input
              placeholder="e.g. Roku_30s_Grandma_V2"
              value={creativeLabel}
              onChange={(e) => setCreativeLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleMint()}
            />
          </div>
          <Button onClick={handleMint} disabled={minting}>
            {minting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Mint 1 number
          </Button>
          <div className="flex items-end gap-2 border-l pl-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Bulk</label>
              <Input
                type="number" min={1} max={50} value={bulkCount}
                onChange={(e) => setBulkCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                className="w-20"
              />
            </div>
            <Button variant="secondary" onClick={handleBulkMint} disabled={minting}>
              Mint {bulkCount}
            </Button>
          </div>
        </div>
        {activeCampaign && (
          <div className="text-xs text-muted-foreground">
            RingFuel campaign ID: <code className="rounded bg-muted px-1 py-0.5">{activeCampaign.ringfuel_campaign_id}</code>
            {' · DNI replacement: '}
            <code className="rounded bg-muted px-1 py-0.5">{formatPhone(activeCampaign.dni_replacement)}</code>
          </div>
        )}
      </Card>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading numbers…
        </div>
      ) : (
        numbersByCampaign.map(({ campaign, rows }) => (
          <Card key={campaign.ringfuel_campaign_id} className="p-4">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="font-semibold">{campaign.label}</h2>
              <span className="text-xs text-muted-foreground">{rows.length} minted</span>
            </div>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No numbers minted yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Creative</TableHead>
                    <TableHead>Number</TableHead>
                    <TableHead>Minted</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((n: any) => (
                    <TableRow key={n.id}>
                      <TableCell className="font-medium">{n.creative_label ?? '—'}</TableCell>
                      <TableCell className="font-mono">{formatPhone(n.phone_number)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(n.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Button size="icon" variant="ghost" onClick={() => {
                          navigator.clipboard.writeText(n.phone_number);
                          toast.success('Copied');
                        }}>
                          <Copy className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        ))
      )}
    </div>
  );
}
