import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, Plus } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import {
  useClientsBasic,
  useExternalProjects,
  useCreditAllocations,
  useSaveExternalProject,
  useDeleteExternalProject,
  useSaveCreditAllocation,
  useDeleteCreditAllocation,
} from '@/hooks/useTechCosts';

const UNASSIGNED = 'unassigned';

function money(n: number) { return `$${n.toFixed(2)}`; }

interface Props {
  startDate: string;
  endDate: string;
}

export function CreditAllocations({ startDate, endDate }: Props) {
  const { data: clients = [] } = useClientsBasic();
  const { data: projects = [] } = useExternalProjects();
  const { data: allocations = [] } = useCreditAllocations(startDate, endDate);

  const saveProject = useSaveExternalProject();
  const deleteProject = useDeleteExternalProject();
  const saveAllocation = useSaveCreditAllocation();
  const deleteAllocation = useDeleteCreditAllocation();

  const clientMap = useMemo(() => {
    const m = new Map<string, string>();
    clients.forEach((c: any) => m.set(c.id, c.name));
    return m;
  }, [clients]);

  // --- new mapping form ---
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectClient, setNewProjectClient] = useState<string>(UNASSIGNED);

  // --- allocation form ---
  const [allocProject, setAllocProject] = useState<string>('');
  const [allocDate, setAllocDate] = useState(endDate);
  const [credits, setCredits] = useState('');
  const [costUsd, setCostUsd] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => { setAllocDate(endDate); }, [endDate]);
  useEffect(() => {
    if (!allocProject && projects.length) setAllocProject(projects[0].project_name);
  }, [projects, allocProject]);

  const selectedProject = projects.find((p) => p.project_name === allocProject);

  const totals = useMemo(() => {
    const byClient = new Map<string, { name: string; credits: number; cost: number }>();
    let cost = 0;
    let cr = 0;
    allocations.forEach((a) => {
      cost += Number(a.cost_usd);
      cr += Number(a.credits);
      const key = a.client_id ?? UNASSIGNED;
      const name = a.client_id ? (clientMap.get(a.client_id) ?? 'Unknown') : 'Unassigned';
      const b = byClient.get(key) ?? { name, credits: 0, cost: 0 };
      b.credits += Number(a.credits);
      b.cost += Number(a.cost_usd);
      byClient.set(key, b);
    });
    return {
      cost,
      credits: cr,
      byClient: Array.from(byClient.values()).sort((a, b) => b.cost - a.cost),
    };
  }, [allocations, clientMap]);

  async function handleAddProject() {
    if (!newProjectName.trim()) return;
    try {
      await saveProject.mutateAsync({
        project_name: newProjectName.trim(),
        client_id: newProjectClient === UNASSIGNED ? null : newProjectClient,
      });
      setNewProjectName('');
      setNewProjectClient(UNASSIGNED);
      toast({ title: 'Project mapped' });
    } catch (e) {
      toast({ title: 'Could not save project', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  }

  async function handleLogAllocation() {
    if (!allocProject) return;
    const cost = Number(costUsd || 0);
    const cr = Number(credits || 0);
    if (cost <= 0 && cr <= 0) {
      toast({ title: 'Enter credits or a USD cost', variant: 'destructive' });
      return;
    }
    try {
      await saveAllocation.mutateAsync({
        project_name: allocProject,
        client_id: selectedProject?.client_id ?? null,
        date: allocDate,
        credits: cr,
        cost_usd: cost,
        note: note.trim() || null,
      });
      setCredits('');
      setCostUsd('');
      setNote('');
      toast({ title: 'Allocation logged' });
    } catch (e) {
      toast({ title: 'Could not log allocation', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  }

  return (
    <div className="space-y-4">
      {/* Project → client mapping */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Workspace project → client mapping</CardTitle>
          <CardDescription>
            Lovable credits spent on other projects in this workspace get passed through to the mapped client.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Bills to</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.length === 0 ? (
                <TableRow><TableCell colSpan={3} className="h-16 text-center text-sm text-muted-foreground">No projects mapped yet</TableCell></TableRow>
              ) : projects.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.project_name}</TableCell>
                  <TableCell>
                    <Select
                      value={p.client_id ?? UNASSIGNED}
                      onValueChange={(v) => saveProject.mutate({
                        id: p.id,
                        project_name: p.project_name,
                        client_id: v === UNASSIGNED ? null : v,
                        notes: p.notes,
                      })}
                    >
                      <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                        {clients.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => deleteProject.mutate(p.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex flex-wrap items-end gap-3 border-t pt-4">
            <div>
              <Label className="text-xs">Project name</Label>
              <Input value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} placeholder="e.g. MiiCloud" className="h-9 w-56" />
            </div>
            <div>
              <Label className="text-xs">Bills to</Label>
              <Select value={newProjectClient} onValueChange={setNewProjectClient}>
                <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                  {clients.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleAddProject} disabled={saveProject.isPending} className="h-9">
              <Plus className="mr-1 h-4 w-4" /> Add project
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Log an allocation */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Log Lovable credit spend</CardTitle>
          <CardDescription>
            Enter the credits and USD cost from the workspace usage report for the period you're passing through.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">Project</Label>
            <Select value={allocProject} onValueChange={setAllocProject}>
              <SelectTrigger className="h-9 w-56"><SelectValue placeholder="Select project" /></SelectTrigger>
              <SelectContent>
                {projects.map((p) => <SelectItem key={p.id} value={p.project_name}>{p.project_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Date</Label>
            <Input type="date" value={allocDate} onChange={(e) => setAllocDate(e.target.value)} className="h-9 w-40" />
          </div>
          <div>
            <Label className="text-xs">Credits</Label>
            <Input type="number" step="0.01" value={credits} onChange={(e) => setCredits(e.target.value)} placeholder="0" className="h-9 w-28" />
          </div>
          <div>
            <Label className="text-xs">Cost (USD)</Label>
            <Input type="number" step="0.01" value={costUsd} onChange={(e) => setCostUsd(e.target.value)} placeholder="0.00" className="h-9 w-32" />
          </div>
          <div className="min-w-48 flex-1">
            <Label className="text-xs">Note</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. August workspace usage" className="h-9" />
          </div>
          <Button onClick={handleLogAllocation} disabled={saveAllocation.isPending} className="h-9">Log</Button>
          <div className="w-full text-xs text-muted-foreground">
            Billing to{' '}
            <span className="font-medium text-foreground">
              {selectedProject?.client_id ? (clientMap.get(selectedProject.client_id) ?? 'Unknown') : 'Unassigned'}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Totals + entries */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-base">Allocated in period</CardTitle></CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tabular-nums">{money(totals.cost)}</div>
            <div className="mt-1 text-xs text-muted-foreground">{totals.credits.toLocaleString()} credits</div>
            <div className="mt-4 space-y-1">
              {totals.byClient.map((b) => (
                <div key={b.name} className="flex items-center justify-between text-sm">
                  <span>{b.name}</span>
                  <span className="font-mono">{money(b.cost)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Allocation entries</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead className="text-right">Credits</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allocations.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="h-20 text-center text-sm text-muted-foreground">No allocations in this period</TableCell></TableRow>
                ) : allocations.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="text-sm">{a.date}</TableCell>
                    <TableCell className="text-sm">
                      {a.project_name}
                      {a.note && <div className="text-xs text-muted-foreground">{a.note}</div>}
                    </TableCell>
                    <TableCell className="text-sm">
                      {a.client_id ? (clientMap.get(a.client_id) ?? 'Unknown') : <Badge variant="secondary" className="text-[10px]">unassigned</Badge>}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">{Number(a.credits).toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{money(Number(a.cost_usd))}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => deleteAllocation.mutate(a.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
