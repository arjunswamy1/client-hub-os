import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Loader2, RefreshCw, ExternalLink, Link2, Unlink, ArrowRightLeft, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

type Client = { id: string; name: string };

type RokuConnection = {
  id: string;
  client_id: string | null;
  status: string | null;
  account_id: string | null;
  account_name: string | null;
  token_expires_at: string | null;
  last_synced_at: string | null;
  sync_error: string | null;
  updated_at: string | null;
};

const AUTH_URL_KEY = 'roku_auth_url_base';
const DEFAULT_AUTH_URL =
  'https://ads.roku.com/integrations/developer?developer_app_uid=PdevappYXhoehLQ&client_id=dRweJlvbDUrUhi3avAp3zEfg6lyRztTr';

export default function RokuConnectionsPage() {
  const { isAdmin } = useAuth();

  const [clients, setClients] = useState<Client[]>([]);
  const [connections, setConnections] = useState<RokuConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [authUrlBase, setAuthUrlBase] = useState(
    () => localStorage.getItem(AUTH_URL_KEY) || DEFAULT_AUTH_URL,
  );

  // manual code exchange
  const [manualClient, setManualClient] = useState<string>('');
  const [manualCode, setManualCode] = useState('');
  const [exchanging, setExchanging] = useState(false);

  // move dialog
  const [moveConn, setMoveConn] = useState<RokuConnection | null>(null);
  const [moveTarget, setMoveTarget] = useState<string>('');
  const [unlinkConn, setUnlinkConn] = useState<RokuConnection | null>(null);

  const redirectUri = useMemo(() => `${window.location.origin}/roku/callback`, []);

  const clientName = (id: string | null) =>
    clients.find((c) => c.id === id)?.name ?? 'Unassigned';

  const load = async () => {
    setLoading(true);
    const [{ data: clientRows }, { data: connRows, error: connErr }] = await Promise.all([
      supabase.from('clients').select('id, name').order('name'),
      supabase
        .from('platform_connections_safe')
        .select('id, client_id, status, account_id, account_name, token_expires_at, last_synced_at, sync_error, updated_at')
        .eq('platform', 'roku')
        .order('updated_at', { ascending: false }),
    ]);
    setClients((clientRows ?? []) as Client[]);
    if (connErr) toast.error(`Could not load connections: ${connErr.message}`);
    setConnections((connRows ?? []) as RokuConnection[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const saveAuthUrl = (value: string) => {
    setAuthUrlBase(value);
    localStorage.setItem(AUTH_URL_KEY, value);
  };

  const authorizeUrl = (clientId: string) => {
    const base = authUrlBase.trim();
    if (!base) return '';
    const sep = base.includes('?') ? '&' : '?';
    const hasRedirect = base.includes('redirect_uri=');
    const redirectPart = hasRedirect ? '' : `${sep}redirect_uri=${encodeURIComponent(redirectUri)}`;
    const stateSep = hasRedirect || redirectPart ? '&' : sep;
    return `${base}${redirectPart}${stateSep}state=${encodeURIComponent(clientId)}`;
  };

  const startAuthorize = (clientId: string) => {
    const url = authorizeUrl(clientId);
    if (!url) {
      toast.error('Add the Roku authorization URL first');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
    toast.info('Approve access in the Roku tab — the connection saves automatically.');
  };

  const exchangeCode = async () => {
    if (!manualClient) return toast.error('Pick a client first');
    if (!manualCode.trim()) return toast.error('Paste the authorization code');
    setExchanging(true);
    try {
      const { data, error } = await supabase.functions.invoke('roku-oauth-exchange', {
        body: { code: manualCode.trim(), client_id: manualClient, redirect_uri: redirectUri },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(`Connected ${clientName(manualClient)} to Roku`);
      setManualCode('');
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExchanging(false);
    }
  };

  const moveConnection = async () => {
    if (!moveConn || !moveTarget) return;
    setBusyId(moveConn.id);
    try {
      // one Roku connection per client: clear whatever the target already has
      const existing = connections.find((c) => c.client_id === moveTarget && c.id !== moveConn.id);
      if (existing) {
        const { error } = await supabase.from('platform_connections').delete().eq('id', existing.id);
        if (error) throw error;
      }
      const { error } = await supabase
        .from('platform_connections')
        .update({ client_id: moveTarget })
        .eq('id', moveConn.id);
      if (error) throw error;
      toast.success(`Connection moved to ${clientName(moveTarget)}`);
      setMoveConn(null);
      setMoveTarget('');
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const unlink = async () => {
    if (!unlinkConn) return;
    setBusyId(unlinkConn.id);
    try {
      const { error } = await supabase.from('platform_connections').delete().eq('id', unlinkConn.id);
      if (error) throw error;
      toast.success('Roku connection removed');
      setUnlinkConn(null);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  if (!isAdmin) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Admins only</CardTitle>
            <CardDescription>Roku connections can only be managed by an admin.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const rows = clients.map((c) => ({
    client: c,
    conn: connections.find((x) => x.client_id === c.id) ?? null,
  }));
  const orphans = connections.filter((c) => !clients.some((cl) => cl.id === c.client_id));

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Roku connections</h1>
          <p className="text-sm text-muted-foreground">
            One Roku Ads connection per client. Link, re-link, or move a connection without creating duplicates.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Roku authorization URL</CardTitle>
          <CardDescription>
            Paste the URL Roku gave you for the developer app. The client is appended as <code>state</code> so the
            connection lands on the right account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input value={authUrlBase} onChange={(e) => saveAuthUrl(e.target.value)} spellCheck={false} />
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded-md border bg-muted px-3 py-2 text-xs">{redirectUri}</code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(redirectUri);
                toast.success('Redirect URI copied');
              }}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Redirect URI registered with Roku.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Clients</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading connections…
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Ad account</TableHead>
                  <TableHead>Token expires</TableHead>
                  <TableHead>Last sync</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ client, conn }) => (
                  <TableRow key={client.id}>
                    <TableCell className="font-medium">{client.name}</TableCell>
                    <TableCell>
                      {conn ? (
                        <Badge variant={conn.status === 'active' ? 'default' : 'secondary'}>
                          {conn.status ?? 'unknown'}
                        </Badge>
                      ) : (
                        <Badge variant="outline">Not connected</Badge>
                      )}
                      {conn?.sync_error && (
                        <div className="mt-1 text-xs text-destructive">{conn.sync_error}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{conn?.account_name ?? conn?.account_id ?? '—'}</TableCell>
                    <TableCell className="text-sm">
                      {conn?.token_expires_at ? new Date(conn.token_expires_at).toLocaleString() : '—'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {conn?.last_synced_at ? new Date(conn.last_synced_at).toLocaleString() : 'Never'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => startAuthorize(client.id)}>
                          {conn ? <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> : <Link2 className="mr-1.5 h-3.5 w-3.5" />}
                          {conn ? 'Re-link' : 'Link'}
                          <ExternalLink className="ml-1.5 h-3 w-3" />
                        </Button>
                        {conn && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busyId === conn.id}
                              onClick={() => {
                                setMoveConn(conn);
                                setMoveTarget('');
                              }}
                            >
                              <ArrowRightLeft className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              disabled={busyId === conn.id}
                              onClick={() => setUnlinkConn(conn)}
                            >
                              <Unlink className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {orphans.map((conn) => (
                  <TableRow key={conn.id}>
                    <TableCell className="font-medium text-muted-foreground">Unassigned connection</TableCell>
                    <TableCell><Badge variant="secondary">{conn.status ?? 'unknown'}</Badge></TableCell>
                    <TableCell className="text-sm">{conn.account_name ?? conn.account_id ?? '—'}</TableCell>
                    <TableCell className="text-sm">
                      {conn.token_expires_at ? new Date(conn.token_expires_at).toLocaleString() : '—'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {conn.last_synced_at ? new Date(conn.last_synced_at).toLocaleString() : 'Never'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => { setMoveConn(conn); setMoveTarget(''); }}>
                          <ArrowRightLeft className="mr-1.5 h-3.5 w-3.5" /> Assign
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => setUnlinkConn(conn)}
                        >
                          <Unlink className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Finish a connection manually</CardTitle>
          <CardDescription>
            If you landed on the callback page without a client in <code>state</code>, paste the code here and pick the
            client. Re-running this on a client that is already connected replaces its tokens instead of adding a second
            connection.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-[220px_1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label>Client</Label>
            <Select value={manualClient} onValueChange={setManualClient}>
              <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Authorization code</Label>
            <Input value={manualCode} onChange={(e) => setManualCode(e.target.value)} placeholder="Paste code from Roku" />
          </div>
          <Button onClick={exchangeCode} disabled={exchanging}>
            {exchanging && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Connect
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={!!moveConn} onOpenChange={(o) => !o && setMoveConn(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move this Roku connection</AlertDialogTitle>
            <AlertDialogDescription>
              Currently on {clientName(moveConn?.client_id ?? null)}. If the target client already has a Roku
              connection, it is replaced so there is never more than one per client.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label>Move to client</Label>
            <Select value={moveTarget} onValueChange={setMoveTarget}>
              <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
              <SelectContent>
                {clients
                  .filter((c) => c.id !== moveConn?.client_id)
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={moveConnection} disabled={!moveTarget}>Move</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!unlinkConn} onOpenChange={(o) => !o && setUnlinkConn(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this Roku connection?</AlertDialogTitle>
            <AlertDialogDescription>
              Stored tokens for {clientName(unlinkConn?.client_id ?? null)} are deleted. Reporting stops until you link
              Roku again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={unlink}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
