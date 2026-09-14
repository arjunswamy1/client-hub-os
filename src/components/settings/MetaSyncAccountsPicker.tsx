/**
 * Admin control for `platform_connections.metadata.sync_ad_accounts`.
 *
 * One Meta token can grant access to many ad accounts — 24 on BuyologyIQ's — and
 * the sync reads `sync_ad_accounts` first, falling back to the single
 * `selected_ad_account`. Anything not listed is silently unsynced, which is how
 * spend can exist in Meta and appear nowhere in this app.
 *
 * This control only records WHICH accounts should sync. It changes no sync
 * behaviour by itself and never runs a sync: some of the accounts on a token
 * belong to other clients, so listing the wrong one would contaminate this
 * client's spend. Saving an empty list clears the override and returns the sync
 * to the single selected account.
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

interface MetaAdAccount {
  id?: string;
  account_id?: string;
  name?: string;
}

const refOf = (a: MetaAdAccount) => a.id || a.account_id || '';

export function MetaSyncAccountsPicker({ clientId }: { clientId: string }) {
  const [saving, setSaving] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);

  const { data: conn, refetch, isLoading } = useQuery({
    queryKey: ['meta-sync-accounts', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('platform_connections')
        .select('id, metadata, selected_ad_account, status, last_synced_at')
        .eq('client_id', clientId)
        .eq('platform', 'meta')
        .maybeSingle();
      if (error) throw error;
      return data as unknown as {
        id: string;
        metadata: { ad_accounts?: MetaAdAccount[]; sync_ad_accounts?: string[] } | null;
        selected_ad_account: MetaAdAccount | null;
        status: string | null;
        last_synced_at: string | null;
      } | null;
    },
  });

  const accounts = useMemo(() => conn?.metadata?.ad_accounts ?? [], [conn]);
  const stored = useMemo(() => conn?.metadata?.sync_ad_accounts ?? null, [conn]);
  const selectedRef = conn?.selected_ad_account ? refOf(conn.selected_ad_account) : null;

  useEffect(() => {
    setChecked(stored ?? (selectedRef ? [selectedRef] : []));
  }, [stored, selectedRef]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex h-24 items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }
  if (!conn) return null;

  const dirty = JSON.stringify([...checked].sort()) !== JSON.stringify([...(stored ?? (selectedRef ? [selectedRef] : []))].sort());

  const save = async () => {
    setSaving(true);
    try {
      const metadata = { ...(conn.metadata ?? {}), sync_ad_accounts: checked.length ? checked : null };
      const { error } = await supabase
        .from('platform_connections')
        .update({ metadata: metadata as never })
        .eq('id', conn.id);
      if (error) throw error;
      toast.success(
        checked.length
          ? `${checked.length} ad account${checked.length === 1 ? '' : 's'} recorded for syncing.`
          : 'Override cleared — the sync falls back to the single selected account.',
      );
      await refetch();
    } catch (e) {
      toast.error(`Could not save: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Meta ad accounts to sync</CardTitle>
        <CardDescription>
          This token grants access to {accounts.length} ad account{accounts.length === 1 ? '' : 's'}. Only the ones
          ticked here are pulled in. Some accounts on a shared token belong to other clients — listing one of those
          would mix its spend into this client's numbers, so tick only the accounts that belong to this client.
          {stored === null && ' No list is recorded yet, so only the single selected account syncs.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border p-2">
          {accounts.length === 0 && (
            <p className="p-2 text-sm text-muted-foreground">
              No ad accounts recorded on this connection. Reconnect Meta to refresh the list.
            </p>
          )}
          {accounts.map((a) => {
            const ref = refOf(a);
            return (
              <label key={ref} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50">
                <Checkbox
                  checked={checked.includes(ref)}
                  onCheckedChange={(v) =>
                    setChecked((prev) => (v ? [...new Set([...prev, ref])] : prev.filter((r) => r !== ref)))
                  }
                />
                <span className="flex-1 text-sm">{a.name || 'Unnamed account'}</span>
                <span className="font-mono text-xs text-muted-foreground">{ref}</span>
                {ref === selectedRef && <Badge variant="secondary">Currently selected</Badge>}
              </label>
            );
          })}
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {checked.length} of {accounts.length} ticked. Saving records the list only — it does not start a sync.
          </p>
          <Button size="sm" disabled={!dirty || saving} onClick={save}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save list
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default MetaSyncAccountsPicker;
