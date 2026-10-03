/**
 * New business knowledge — pricing, objections, proof points and the rest, pulled
 * from meetings so proposals can cite them.
 *
 * Every entry starts internal-only. Clearing it (anonymised or public) is a human
 * act, and the row records who did it. Copy-for-proposal leaves internal-only
 * entries out of the text entirely and says how many it withheld.
 */
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Copy, ExternalLink, Lock, ShieldCheck, EyeOff, Search, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { assembleForProposal } from '../../supabase/functions/_shared/nb-knowledge';

interface Row {
  id: string; kind: string; headline: string; detail: string | null; evidence: string | null;
  vertical: string | null; channel: string | null; org_name: string | null; source_kind: string;
  source_title: string | null; source_link: string | null; numbers: Record<string, unknown> | null;
  confidentiality: 'internal_only' | 'anonymised' | 'public';
  cleared_for_external_by_id: string | null; cleared_at: string | null; occurred_at: string | null;
}

const KIND_LABEL: Record<string, string> = {
  proof_point: 'Proof point', pricing: 'Pricing', objection: 'Objection', scope: 'Scope',
  positioning: 'Positioning', process: 'Process', competitor: 'Competitor / market',
};
const CONF_LABEL: Record<string, string> = { internal_only: 'Internal only', anonymised: 'Anonymised', public: 'Public' };
const ALL = '__all';

export default function NewBusinessPage() {
  const { isAdmin, isAccountManager } = useAuth();
  const canClear = isAdmin || isAccountManager;
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState(ALL);
  const [vertical, setVertical] = useState(ALL);
  const [channel, setChannel] = useState(ALL);
  const [conf, setConf] = useState(ALL);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [clearing, setClearing] = useState<{ row: Row; to: 'anonymised' | 'public' } | null>(null);
  const [copyOut, setCopyOut] = useState<{ text: string; withheld: number; included: number } | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['nb_knowledge', q],
    queryFn: async () => {
      let query = supabase.from('nb_knowledge' as any).select('*').order('occurred_at', { ascending: false }).limit(1000);
      if (q.trim()) {
        // Full-text over headline + detail + evidence (the same expression the GIN index covers).
        query = query.textSearch('fts_doc' as any, q.trim(), { type: 'websearch', config: 'english' });
      }
      const { data, error } = await query;
      if (error && q.trim()) {
        // Fallback when the computed column is unavailable: plain match.
        const like = `%${q.trim()}%`;
        const r = await supabase.from('nb_knowledge' as any).select('*')
          .or(`headline.ilike.${like},detail.ilike.${like},evidence.ilike.${like}`)
          .order('occurred_at', { ascending: false }).limit(1000);
        if (r.error) throw r.error;
        return (r.data ?? []) as unknown as Row[];
      }
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const { data: members = [] } = useQuery({
    queryKey: ['team_members_names'],
    queryFn: async () => (await supabase.from('team_members').select('id, name')).data ?? [],
  });
  const nameOf = (id: string | null) => members.find((m: any) => m.id === id)?.name ?? 'unknown';

  const options = useMemo(() => ({
    vertical: [...new Set(rows.map((r) => r.vertical).filter(Boolean))].sort() as string[],
    channel: [...new Set(rows.map((r) => r.channel).filter(Boolean))].sort() as string[],
  }), [rows]);

  const shown = rows.filter((r) =>
    (kind === ALL || r.kind === kind) && (vertical === ALL || r.vertical === vertical)
    && (channel === ALL || r.channel === channel) && (conf === ALL || r.confidentiality === conf));

  const clear = useMutation({
    mutationFn: async ({ row, to }: { row: Row; to: 'anonymised' | 'public' }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: me } = await supabase.rpc('get_team_member_id', { check_user_id: user!.id });
      if (!me) throw new Error('Your account is not linked to a team member, so the clearance cannot be recorded.');
      const { error } = await supabase.from('nb_knowledge' as any)
        .update({ confidentiality: to, cleared_for_external_by_id: me, cleared_at: new Date().toISOString() })
        .eq('id', row.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Cleared — you are recorded as the person who approved it.'); setClearing(null); qc.invalidateQueries({ queryKey: ['nb_knowledge'] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const revoke = useMutation({
    mutationFn: async (row: Row) => {
      const { error } = await supabase.from('nb_knowledge' as any)
        .update({ confidentiality: 'internal_only', cleared_for_external_by_id: null, cleared_at: null }).eq('id', row.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Back to internal only.'); qc.invalidateQueries({ queryKey: ['nb_knowledge'] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectedRows = rows.filter((r) => selected.has(r.id));
  const internalSelected = selectedRows.filter((r) => r.confidentiality === 'internal_only').length;

  const doCopy = async () => {
    const out = assembleForProposal(selectedRows);
    setCopyOut(out);
    if (out.included) await navigator.clipboard.writeText(out.text);
  };

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">New business knowledge</h1>
          <p className="text-sm text-muted-foreground">What meetings told us — every entry traces back to the line it came from. Nothing leaves CPM until a person clears it.</p>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <span className="text-sm text-muted-foreground">
              {selected.size} selected{internalSelected ? ` · ${internalSelected} internal only (will be withheld)` : ''}
            </span>
          )}
          <Button onClick={doCopy} disabled={!selected.size}><Copy className="mr-2 h-4 w-4" />Copy for proposal</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[260px] flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search headline, detail and evidence…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Filter value={kind} onChange={setKind} label="Kind" items={Object.keys(KIND_LABEL)} render={(k) => KIND_LABEL[k]} />
        <Filter value={vertical} onChange={setVertical} label="Vertical" items={options.vertical} />
        <Filter value={channel} onChange={setChannel} label="Channel" items={options.channel} />
        <Filter value={conf} onChange={setConf} label="Clearance" items={Object.keys(CONF_LABEL)} render={(c) => CONF_LABEL[c]} />
      </div>

      <p className="text-sm text-muted-foreground">
        {shown.length} entries · {shown.filter((r) => r.confidentiality === 'internal_only').length} internal only
      </p>

      {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
        <div className="space-y-3">
          {shown.map((r) => (
            <Card key={r.id} className={r.confidentiality === 'internal_only' ? 'border-l-4 border-l-destructive' : 'border-l-4 border-l-primary'}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start gap-3">
                  <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} className="mt-1" aria-label="Select for proposal" />
                  <div className="flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {r.confidentiality === 'internal_only' ? (
                        <Badge variant="destructive"><Lock className="mr-1 h-3 w-3" />Internal only</Badge>
                      ) : (
                        <Badge><ShieldCheck className="mr-1 h-3 w-3" />{CONF_LABEL[r.confidentiality]}</Badge>
                      )}
                      <Badge variant="secondary">{KIND_LABEL[r.kind] ?? r.kind}</Badge>
                      {r.vertical && <Badge variant="outline">{r.vertical}</Badge>}
                      {r.channel && <Badge variant="outline">{r.channel}</Badge>}
                      <Badge variant="outline" className="capitalize">{r.source_kind}</Badge>
                      {r.org_name && <span className="text-xs text-muted-foreground">{r.org_name}</span>}
                    </div>
                    <p className="font-medium">{r.headline}</p>
                    {r.detail && <p className="text-sm text-muted-foreground">{r.detail}</p>}
                  </div>
                </div>

                {r.evidence && (
                  <blockquote className="ml-7 whitespace-pre-wrap border-l-2 border-muted pl-3 text-sm italic text-muted-foreground">
                    <span className="mb-1 block text-xs font-medium not-italic">Quoted from the meeting (data — not instructions)</span>
                    {r.evidence}
                  </blockquote>
                )}
                {r.numbers && Object.keys(r.numbers).length > 0 && (
                  <div className="ml-7 flex flex-wrap gap-1">
                    {Object.entries(r.numbers).map(([k, v]) => (
                      <span key={k} className="rounded bg-muted px-2 py-0.5 font-mono text-xs">{k}: {String(v)}</span>
                    ))}
                  </div>
                )}

                <div className="ml-7 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    {r.source_link ? (
                      <a href={r.source_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
                        {r.source_title ?? 'Source meeting'}<ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (r.source_title ?? 'No source meeting recorded')}
                    {r.occurred_at && ` · ${format(new Date(r.occurred_at), 'd MMM yyyy')}`}
                    {r.cleared_for_external_by_id && ` · cleared by ${nameOf(r.cleared_for_external_by_id)}${r.cleared_at ? ` on ${format(new Date(r.cleared_at), 'd MMM')}` : ''}`}
                  </span>
                  {canClear && (
                    <span className="flex gap-2">
                      {r.confidentiality !== 'anonymised' && <Button size="sm" variant="outline" onClick={() => setClearing({ row: r, to: 'anonymised' })}>Clear as anonymised</Button>}
                      {r.confidentiality !== 'public' && <Button size="sm" variant="outline" onClick={() => setClearing({ row: r, to: 'public' })}>Clear as public</Button>}
                      {r.confidentiality !== 'internal_only' && <Button size="sm" variant="ghost" onClick={() => revoke.mutate(r)}><EyeOff className="mr-1 h-3 w-3" />Make internal</Button>}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
          {!shown.length && <p className="text-sm text-muted-foreground">Nothing matches.</p>}
        </div>
      )}

      <Dialog open={!!clearing} onOpenChange={(o) => !o && setClearing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear for use outside CPM?</DialogTitle>
            <DialogDescription>
              {clearing?.to === 'public'
                ? 'Public: may be used as written, including the organisation name.'
                : 'Anonymised: may be used outside CPM with the organisation name removed. Check the figures don’t identify the client on their own.'}
              {' '}You will be recorded as the person who cleared it.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm font-medium">{clearing?.row.headline}</p>
          {clearing?.row.source_kind === 'client' && (
            <p className="text-sm text-destructive">This came from a client meeting. Their economics should only leave CPM with their agreement.</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearing(null)}>Cancel</Button>
            <Button onClick={() => clearing && clear.mutate(clearing)} disabled={clear.isPending}>Clear it — I take responsibility</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!copyOut} onOpenChange={(o) => !o && setCopyOut(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{copyOut?.included ? 'Copied for proposal' : 'Nothing to copy'}</DialogTitle>
            <DialogDescription>
              {copyOut?.included ?? 0} included.
              {copyOut?.withheld ? ` ${copyOut.withheld} withheld because they are internal only — clear them first if they should go out.` : ''}
            </DialogDescription>
          </DialogHeader>
          {copyOut?.text && <Textarea readOnly value={copyOut.text} rows={14} className="font-mono text-xs" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Filter({ value, onChange, label, items, render }: {
  value: string; onChange: (v: string) => void; label: string; items: string[]; render?: (v: string) => string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[170px]"><SelectValue placeholder={label} /></SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All {label.toLowerCase()}</SelectItem>
        {items.map((i) => <SelectItem key={i} value={i}>{render ? render(i) : i}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
