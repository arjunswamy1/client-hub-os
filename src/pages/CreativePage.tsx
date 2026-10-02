
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Circle, Check, ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useCreativeBriefs, useBriefMutations } from '@/hooks/useCreativeBriefs';
import { BriefSubmissionForm } from '@/components/creative/BriefSubmissionForm';
import { BriefKanban } from '@/components/creative/BriefKanban';
import { BriefDetailPanel } from '@/components/creative/BriefDetailPanel';
import { DesignerWorkspace } from '@/components/creative/DesignerWorkspace';
import { DesignerDashboard } from '@/components/creative/DesignerDashboard';
import { MyWorkQueue } from '@/components/creative/MyWorkQueue';
import { TraffickingQueue } from '@/components/creative/TraffickingQueue';
import { HoursDashboard } from '@/components/creative/HoursDashboard';
import { WorkCalendar } from '@/components/creative/WorkCalendar';
import { DateRangeProvider } from '@/contexts/DateRangeContext';
import DateRangePicker from '@/components/dashboard/DateRangePicker';
import { ContentCalendar } from '@/components/trafficking/ContentCalendar';
import { CampaignList } from '@/components/trafficking/CampaignList';
import { InProgressAds } from '@/components/trafficking/InProgressAds';
import { LiveAdsTracker } from '@/components/trafficking/LiveAdsTracker';
import { Client } from '@/types';

function TraffickingClientPicker({ clients, selected, onSelect }: {
  clients: Client[];
  selected: Client | null;
  onSelect: (c: Client) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm transition-colors hover:bg-accent">
          {selected ? (
            <>
              <Circle className="h-2.5 w-2.5 shrink-0 fill-current" style={{ color: selected.color || 'hsl(220, 70%, 50%)' }} />
              <span className="truncate max-w-[160px]">{selected.name}</span>
            </>
          ) : (
            <span className="text-muted-foreground">Select client…</span>
          )}
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="start">
        {clients.map((client) => (
          <button
            key={client.id}
            className="flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-sm transition-colors hover:bg-accent"
            onClick={() => { onSelect(client); setOpen(false); }}
          >
            <Circle className="h-2.5 w-2.5 shrink-0 fill-current" style={{ color: client.color || 'hsl(220, 70%, 50%)' }} />
            <span className="flex-1 truncate">{client.name}</span>
            {selected?.id === client.id && <Check className="h-3.5 w-3.5 text-primary" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export default function CreativePage() {
  const { isDesigner, isAdmin, isAccountManager } = useAuth();
  const canManageDesigners = isAdmin || isAccountManager;
  const { clients } = useClient();
  const { data: briefs = [] } = useCreativeBriefs({ allClients: true });
  const { updateStatus } = useBriefMutations();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [traffickingClient, setTraffickingClient] = useState<Client | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [prefilledClientId, setPrefilledClientId] = useState<string | undefined>();

  // Auto-open brief form when navigated from task tracker (?newBrief=1)
  useEffect(() => {
    if (searchParams.get('newBrief') === '1') {
      setPrefilledClientId(searchParams.get('clientId') || undefined);
      setIsCreateOpen(true);
      // Clean the URL
      searchParams.delete('newBrief');
      searchParams.delete('clientId');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Deep link from the Slack "View Brief" button (?brief=<id>)
  useEffect(() => {
    const id = searchParams.get('brief');
    if (id) setSelectedId(id);
  }, [searchParams]);

  const selected = briefs.find((b: any) => b.id === selectedId);

  // Designer gets their own workspace
  if (isDesigner) {
    return (
      <div className="space-y-6">
        <Tabs defaultValue="dashboard">
          <div className="flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
              <TabsTrigger value="mywork">My Work</TabsTrigger>
              <TabsTrigger value="kanban">Kanban</TabsTrigger>
              <TabsTrigger value="planner">Planner</TabsTrigger>
              <TabsTrigger value="hours">Work Log</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="dashboard" className="mt-4">
            <DesignerDashboard onBriefClick={setSelectedId} />
          </TabsContent>

          <TabsContent value="mywork" className="mt-4">
            <MyWorkQueue onBriefClick={setSelectedId} />
          </TabsContent>

          <TabsContent value="kanban" className="mt-4">
            <BriefKanban
              briefs={briefs}
              onBriefClick={setSelectedId}
              onStatusChange={(id, status) => updateStatus.mutate({ id, status })}
            />
          </TabsContent>

          <TabsContent value="planner" className="mt-4">
            <DesignerWorkspace onBriefClick={setSelectedId} view="planner" />
          </TabsContent>

          <TabsContent value="hours" className="mt-4">
            <WorkCalendar />
          </TabsContent>
        </Tabs>

        {selected && (
          <BriefDetailPanel brief={selected} onClose={() => setSelectedId(null)} />
        )}
      </div>
    );
  }

  // AM / Admin view
  return (
    <DateRangeProvider>
      <div className="space-y-6">
        <Tabs defaultValue="kanban">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Creative Production</h1>
              <p className="text-sm text-muted-foreground">{briefs.length} briefs across all clients</p>
            </div>
            <div className="flex items-center gap-3">
              <TabsList>
                <TabsTrigger value="kanban">Kanban</TabsTrigger>
                <TabsTrigger value="brief-trafficking">Brief Trafficking</TabsTrigger>
                <TabsTrigger value="ad-trafficking">Ad Trafficking</TabsTrigger>
                {canManageDesigners && <TabsTrigger value="planner">Designer Planner</TabsTrigger>}
                {canManageDesigners && <TabsTrigger value="hours">Designer Hours</TabsTrigger>}
              </TabsList>
              <Button size="sm" onClick={() => setIsCreateOpen(true)}>
                <Plus className="mr-1 h-4 w-4" /> New Brief
              </Button>
            </div>
          </div>

          <TabsContent value="kanban" className="mt-4">
            <BriefKanban
              briefs={briefs}
              onBriefClick={setSelectedId}
              onStatusChange={(id, status) => updateStatus.mutate({ id, status })}
            />
          </TabsContent>

          <TabsContent value="brief-trafficking" className="mt-4">
            <TraffickingQueue />
          </TabsContent>

          <TabsContent value="ad-trafficking" className="mt-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <TraffickingClientPicker
                    clients={clients}
                    selected={traffickingClient}
                    onSelect={setTraffickingClient}
                  />
                  <p className="text-sm text-muted-foreground">Plan, build, and launch ads from one place.</p>
                </div>
                {traffickingClient && <DateRangePicker />}
              </div>

              {traffickingClient ? (
                <Tabs defaultValue="in-progress" className="space-y-4">
                  <TabsList>
                    <TabsTrigger value="calendar">Content Calendar</TabsTrigger>
                    <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
                    <TabsTrigger value="in-progress">🟡 In Progress</TabsTrigger>
                    <TabsTrigger value="live">🟢 Live Ads</TabsTrigger>
                  </TabsList>
                  <TabsContent value="calendar">
                    <ContentCalendar clientId={traffickingClient.id} />
                  </TabsContent>
                  <TabsContent value="campaigns">
                    <CampaignList clientId={traffickingClient.id} />
                  </TabsContent>
                  <TabsContent value="in-progress">
                    <InProgressAds clientId={traffickingClient.id} />
                  </TabsContent>
                  <TabsContent value="live">
                    <LiveAdsTracker clientId={traffickingClient.id} />
                  </TabsContent>
                </Tabs>
              ) : (
                <div className="flex items-center justify-center h-64 text-muted-foreground border border-dashed rounded-lg">
                  Select a client above to manage ad trafficking.
                </div>
              )}
            </div>
          </TabsContent>

          {canManageDesigners && (
            <TabsContent value="planner" className="mt-4">
              <DesignerWorkspace onBriefClick={setSelectedId} view="planner" isAdminView />
            </TabsContent>
          )}

          {canManageDesigners && (
            <TabsContent value="hours" className="mt-4">
              <HoursDashboard />
            </TabsContent>
          )}
        </Tabs>

        {selected && (
          <BriefDetailPanel brief={selected} onClose={() => setSelectedId(null)} />
        )}

        <BriefSubmissionForm
          open={isCreateOpen}
          onOpenChange={(o) => { setIsCreateOpen(o); if (!o) setPrefilledClientId(undefined); }}
          clientId={prefilledClientId}
        />
      </div>
    </DateRangeProvider>
  );
}
