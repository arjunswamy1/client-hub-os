
import { useState } from 'react';
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
import { TraffickingQueue } from '@/components/creative/TraffickingQueue';
import { HoursDashboard } from '@/components/creative/HoursDashboard';
import { DateRangeProvider } from '@/contexts/DateRangeContext';
import DateRangePicker from '@/components/dashboard/DateRangePicker';
import { ContentCalendar } from '@/components/trafficking/ContentCalendar';
import { CampaignList } from '@/components/trafficking/CampaignList';
import { InProgressAds } from '@/components/trafficking/InProgressAds';
import { LiveAdsTracker } from '@/components/trafficking/LiveAdsTracker';
import { Client } from '@/types';

export default function CreativePage() {
  const { isDesigner, isAdmin } = useAuth();
  const { activeClient } = useClient();
  const { data: briefs = [] } = useCreativeBriefs({ allClients: true });
  const { updateStatus } = useBriefMutations();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = briefs.find((b: any) => b.id === selectedId);

  // Designer gets their own workspace
  if (isDesigner) {
    return (
      <div className="space-y-6">
        <Tabs defaultValue="queue">
          <div className="flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="queue">My Queue</TabsTrigger>
              <TabsTrigger value="planner">Daily Planner</TabsTrigger>
              <TabsTrigger value="hours">Hours</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="queue" className="mt-4">
            <DesignerWorkspace onBriefClick={setSelectedId} view="queue" />
          </TabsContent>

          <TabsContent value="planner" className="mt-4">
            <DesignerWorkspace onBriefClick={setSelectedId} view="planner" />
          </TabsContent>

          <TabsContent value="hours" className="mt-4">
            <HoursDashboard />
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
                {isAdmin && <TabsTrigger value="planner">Designer Planner</TabsTrigger>}
                {isAdmin && <TabsTrigger value="hours">Designer Hours</TabsTrigger>}
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
            {activeClient ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">Plan, build, and launch ads from one place.</p>
                  <DateRangePicker />
                </div>
                <Tabs defaultValue="in-progress" className="space-y-4">
                  <TabsList>
                    <TabsTrigger value="calendar">Content Calendar</TabsTrigger>
                    <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
                    <TabsTrigger value="in-progress">🟡 In Progress</TabsTrigger>
                    <TabsTrigger value="live">🟢 Live Ads</TabsTrigger>
                  </TabsList>
                  <TabsContent value="calendar">
                    <ContentCalendar clientId={activeClient.id} />
                  </TabsContent>
                  <TabsContent value="campaigns">
                    <CampaignList clientId={activeClient.id} />
                  </TabsContent>
                  <TabsContent value="in-progress">
                    <InProgressAds clientId={activeClient.id} />
                  </TabsContent>
                  <TabsContent value="live">
                    <LiveAdsTracker clientId={activeClient.id} />
                  </TabsContent>
                </Tabs>
              </div>
            ) : (
              <div className="flex items-center justify-center h-64 text-muted-foreground">
                Select a client to manage ad trafficking.
              </div>
            )}
          </TabsContent>

          {isAdmin && (
            <TabsContent value="planner" className="mt-4">
              <DesignerWorkspace onBriefClick={setSelectedId} view="planner" isAdminView />
            </TabsContent>
          )}

          {isAdmin && (
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
          onOpenChange={setIsCreateOpen}
        />
      </div>
    </DateRangeProvider>
  );
}
