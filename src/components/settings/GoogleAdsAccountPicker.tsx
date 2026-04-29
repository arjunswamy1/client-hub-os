import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { GoogleAdsIcon } from '@/components/icons/BrandIcons';
import { Loader2, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

type Connection = {
  id: string;
  customer_id: string | null;
  metadata: { customers?: string[] } | null;
  last_synced_at: string | null;
  last_sync_records: number | null;
  sync_error: string | null;
};

type Props = { clientId: string };

export function GoogleAdsAccountPicker({ clientId }: Props) {
  const [conn, setConn] = useState<Connection | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [selected, setSelected] = useState<string>('');

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('platform_connections')
      .select('id, customer_id, metadata, last_synced_at, last_sync_records, sync_error')
      .eq('client_id', clientId)
      .eq('platform', 'google')
      .eq('status', 'active')
      .maybeSingle();
    setConn(data as Connection | null);
    setSelected((data as Connection | null)?.customer_id || '');
    setLoading(false);
  };

  useEffect(() => { load(); }, [clientId]);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading Google Ads mapping…
        </CardContent>
      </Card>
    );
  }

  if (!conn) return null;

  const customers = (conn.metadata?.customers || []).map((c) => c.replace('customers/', ''));
  const hasMapping = !!conn.customer_id;
  const showWarning = customers.length > 1 && !hasMapping;

  const handleSave = async () => {
    if (!selected) {
      toast.error('Pick an account first');
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('platform_connections')
      .update({ customer_id: selected.replace('customers/', '') })
      .eq('id', conn.id);
    setSaving(false);
    if (error) {
      toast.error(`Failed to save: ${error.message}`);
    } else {
      toast.success('Account mapping saved. Run a sync to refresh data.');
      load();
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('sync-google-ads', {
        body: { client_id: clientId, days_back: 30 },
      });
      if (error) throw error;
      toast.success(`Sync complete — ${data?.records_synced ?? 0} records`);
      load();
    } catch (err: any) {
      toast.error(`Sync failed: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <GoogleAdsIcon className="h-4 w-4" /> Google Ads Account Mapping
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {showWarning && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">No account selected</p>
              <p>This Google login can access {customers.length} ad accounts. Pick the one that belongs to this client — otherwise data from all accounts will be merged into this client's metrics (and may collide with other clients).</p>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Pull data from this Google Ads account</label>
          <div className="flex gap-2">
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder={customers.length ? 'Choose an account…' : 'No accessible accounts'} />
              </SelectTrigger>
              <SelectContent>
                {customers.map((cid) => (
                  <SelectItem key={cid} value={cid}>
                    Customer {cid}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleSave} disabled={saving || !selected || selected === conn.customer_id} size="sm">
              {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Save
            </Button>
          </div>
          {hasMapping && (
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-green-600" />
              Currently mapped to <span className="font-mono">{conn.customer_id}</span>
            </p>
          )}
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="space-y-1">
            <p className="text-xs font-medium">Last sync</p>
            <p className="text-[11px] text-muted-foreground">
              {conn.last_synced_at
                ? `${formatDistanceToNow(new Date(conn.last_synced_at), { addSuffix: true })} • ${conn.last_sync_records ?? 0} records`
                : 'Never synced'}
            </p>
            {conn.sync_error && (
              <Badge variant="destructive" className="text-[10px] mt-1">
                {conn.sync_error.slice(0, 80)}
              </Badge>
            )}
          </div>
          <Button onClick={handleSync} disabled={syncing} size="sm" variant="outline">
            {syncing ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
            Sync now
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
