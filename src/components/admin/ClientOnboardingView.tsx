import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Copy, Plus, AlertTriangle, CheckCircle2, Clock, ExternalLink } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

interface OnboardingClient {
  id: string;
  token: string;
  client_id: string;
  client_name: string;
  company: string | null;
  status: string;
  created_at: string;
  responses?: any[];
  context?: any;
}

function GenerateTokenDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientName, setClientName] = useState('');
  const [company, setCompany] = useState('');
  const [clients, setClients] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (open) {
      supabase.from('clients').select('id, name').order('name').then(({ data }) => {
        setClients(data || []);
      });
    }
  }, [open]);

  const handleCreate = async () => {
    if (!clientId) { toast.error('Select a client'); return; }
    setCreating(true);
    const token = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const selectedClient = clients.find(c => c.id === clientId);
    
    const { error } = await supabase.from('onboarding_tokens').insert({
      token,
      client_id: clientId,
      client_name: clientName || selectedClient?.name || '',
      company,
      status: 'invited',
    });

    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Token created!');
      setOpen(false);
      onCreated();
    }
    setCreating(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Generate Onboarding Link</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Create Onboarding Token</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <label className="text-sm font-medium">Client</label>
            <select
              value={clientId}
              onChange={e => {
                setClientId(e.target.value);
                const c = clients.find(cl => cl.id === e.target.value);
                if (c) setClientName(c.name);
              }}
              className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="">Select...</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">Display Name</label>
            <Input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Client name shown in onboarding" />
          </div>
          <div>
            <label className="text-sm font-medium">Company (optional)</label>
            <Input value={company} onChange={e => setCompany(e.target.value)} />
          </div>
          <Button onClick={handleCreate} disabled={creating} className="w-full">
            {creating ? 'Creating...' : 'Create Token'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ResponseViewer({ responses, context }: { responses: any[]; context: any }) {
  const sections = ['campaign', 'creative', 'access', 'other'];
  
  return (
    <Tabs defaultValue="responses" className="w-full">
      <TabsList>
        <TabsTrigger value="responses">Responses</TabsTrigger>
        <TabsTrigger value="context">Structured Context</TabsTrigger>
      </TabsList>
      <TabsContent value="responses" className="space-y-4">
        {sections.map(section => {
          const resp = responses.find((r: any) => r.section === section);
          if (!resp) return (
            <Card key={section}>
              <CardHeader className="py-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  <CardTitle className="text-sm capitalize">{section}</CardTitle>
                  <Badge variant="outline" className="text-amber-600">Missing</Badge>
                </div>
              </CardHeader>
            </Card>
          );
          return (
            <Card key={section}>
              <CardHeader className="py-3">
                <div className="flex items-center gap-2">
                  {resp.completed_at 
                    ? <CheckCircle2 className="w-4 h-4 text-green-500" />
                    : <Clock className="w-4 h-4 text-amber-500" />
                  }
                  <CardTitle className="text-sm capitalize">{section}</CardTitle>
                  <Badge variant={resp.completed_at ? 'default' : 'outline'}>
                    {resp.completed_at ? 'Complete' : 'In Progress'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-60">
                  {JSON.stringify(resp.data, null, 2)}
                </pre>
              </CardContent>
            </Card>
          );
        })}
      </TabsContent>
      <TabsContent value="context">
        {context ? (
          <Card>
            <CardContent className="pt-6">
              <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-96">
                {JSON.stringify(context.full_context, null, 2)}
              </pre>
              {context.ai_summary && (
                <div className="mt-4">
                  <h4 className="text-sm font-semibold mb-2">AI Summary</h4>
                  <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-40">
                    {JSON.stringify(context.ai_summary, null, 2)}
                  </pre>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              No context generated yet. The client needs to complete onboarding first.
            </CardContent>
          </Card>
        )}
      </TabsContent>
    </Tabs>
  );
}

export function ClientOnboardingView() {
  const [tokens, setTokens] = useState<OnboardingClient[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedToken, setSelectedToken] = useState<OnboardingClient | null>(null);
  const [responses, setResponses] = useState<any[]>([]);
  const [context, setContext] = useState<any>(null);

  const fetchTokens = async () => {
    setIsLoading(true);
    const { data } = await supabase
      .from('onboarding_tokens')
      .select('*')
      .order('created_at', { ascending: false });
    setTokens((data as OnboardingClient[]) || []);
    setIsLoading(false);
  };

  useEffect(() => { fetchTokens(); }, []);

  const loadDetails = async (t: OnboardingClient) => {
    setSelectedToken(t);
    const [{ data: resp }, { data: ctx }] = await Promise.all([
      supabase.from('onboarding_responses').select('*').eq('client_id', t.client_id),
      supabase.from('client_context').select('*').eq('client_id', t.client_id).maybeSingle(),
    ]);
    setResponses(resp || []);
    setContext(ctx);
  };

  const copyLink = (token: string) => {
    const url = `${window.location.origin}/onboarding/${token}`;
    navigator.clipboard.writeText(url);
    toast.success('Link copied!');
  };

  const statusColor = (s: string) => {
    switch (s) {
      case 'invited': return 'bg-blue-100 text-blue-700';
      case 'onboarding': return 'bg-amber-100 text-amber-700';
      case 'active': return 'bg-green-100 text-green-700';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  if (selectedToken) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => setSelectedToken(null)}>← Back to list</Button>
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold">{selectedToken.client_name}</h2>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusColor(selectedToken.status)}`}>
            {selectedToken.status}
          </span>
        </div>
        {selectedToken.company && <p className="text-sm text-muted-foreground">{selectedToken.company}</p>}
        <ResponseViewer responses={responses} context={context} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Client Onboarding</h2>
        <GenerateTokenDialog onCreated={fetchTokens} />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : tokens.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No onboarding tokens yet. Generate one to invite a client.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {tokens.map(t => (
            <Card key={t.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => loadDetails(t)}>
              <CardContent className="py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div>
                    <div className="font-semibold text-sm">{t.client_name}</div>
                    {t.company && <div className="text-xs text-muted-foreground">{t.company}</div>}
                  </div>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusColor(t.status)}`}>
                    {t.status}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); copyLink(t.token); }}>
                    <Copy className="w-3.5 h-3.5 mr-1" /> Copy Link
                  </Button>
                  <ExternalLink className="w-4 h-4 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
