/**
 * Accepted exceptions for the daily data-integrity monitor.
 *
 * A gap that is correct for an account (Tinned Fish Club has no call tracking by
 * design) must not be filed every morning, or the monitor becomes noise. It must
 * also not disappear from view: an exception is a decision someone made, so it is
 * listed here with its reason and its expiry, and can be removed in one click.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Trash2, ShieldCheck } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

const CHECK_KEYS = [
  'no_media_buyer',
  'no_internal_channel',
  'no_media_brain_instance',
  'no_spend_data',
  'no_call_data',
  'stale_data_feed',
];

const CHECK_LABEL: Record<string, string> = {
  no_media_buyer: 'No account lead assigned',
  no_internal_channel: 'No internal Slack channel mapped',
  no_media_brain_instance: 'No Media Brain instance',
  no_spend_data: 'No spend data',
  no_call_data: 'No call data',
  stale_data_feed: 'Data feed gone stale',
};

export function DataIntegrityExceptions() {
  const queryClient = useQueryClient();
  const [clientId, setClientId] = useState('');
  const [checkKey, setCheckKey] = useState('');
  const [reason, setReason] = useState('');
  const [expires, setExpires] = useState('');

  const { data: clients = [] } = useQuery({
    queryKey: ['all_clients'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('id, name').order('name');
      if (error) throw error;
      return data;
    },
  });

  const { data: exceptions = [], isLoading } = useQuery({
    queryKey: ['integrity_exceptions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('data_integrity_exceptions')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      if (!clientId || !checkKey || !reason.trim()) throw new Error('Client, check and reason are all required');
      const { error } = await supabase.from('data_integrity_exceptions').insert({
        client_id: clientId,
        check_key: checkKey,
        reason: reason.trim(),
        expires_at: expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setClientId(''); setCheckKey(''); setReason(''); setExpires('');
      queryClient.invalidateQueries({ queryKey: ['integrity_exceptions'] });
      toast.success('Exception added — this check will be skipped for that account');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('data_integrity_exceptions').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrity_exceptions'] });
      toast.success('Exception removed — the check applies again');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const nameFor = (id: string | null) =>
    clients.find((c: any) => c.id === id)?.name ?? 'All clients';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          Data integrity exceptions
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Checks listed here are skipped for that account instead of being filed as a task every
          morning. Give a reason, and an expiry where the gap is only temporarily acceptable.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-2 md:grid-cols-[1fr_1fr_2fr_auto_auto] md:items-end">
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger><SelectValue placeholder="Client" /></SelectTrigger>
            <SelectContent>
              {clients.map((c: any) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={checkKey} onValueChange={setCheckKey}>
            <SelectTrigger><SelectValue placeholder="Check" /></SelectTrigger>
            <SelectContent>
              {CHECK_KEYS.map((k) => (
                <SelectItem key={k} value={k}>{CHECK_LABEL[k] ?? k}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="Why this is correct for this account"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
          <Button onClick={() => add.mutate()} disabled={add.isPending}>Add</Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Client</th>
                <th className="py-2 pr-4 font-medium">Check</th>
                <th className="py-2 pr-4 font-medium">Reason</th>
                <th className="py-2 pr-4 font-medium">Expires</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {exceptions.map((e: any) => {
                const expired = e.expires_at && new Date(e.expires_at) < new Date();
                return (
                  <tr key={e.id} className="border-b last:border-0">
                    <td className="py-2.5 pr-4 font-medium">{nameFor(e.client_id)}</td>
                    <td className="py-2.5 pr-4">{CHECK_LABEL[e.check_key] ?? e.check_key}</td>
                    <td className="py-2.5 pr-4 text-muted-foreground">{e.reason}</td>
                    <td className="py-2.5 pr-4">
                      {e.expires_at ? (
                        <Badge variant={expired ? 'destructive' : 'secondary'} className="text-xs">
                          {expired ? 'expired ' : ''}{format(new Date(e.expires_at), 'd MMM yyyy')}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">no expiry</span>
                      )}
                    </td>
                    <td className="py-2.5 text-right">
                      <Button
                        variant="ghost" size="icon"
                        onClick={() => remove.mutate(e.id)}
                        disabled={remove.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {!exceptions.length && !isLoading && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-muted-foreground">
                    No exceptions — every check applies to every account.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
