
import { useState } from 'react';
import { useClient } from '@/contexts/ClientContext';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus } from 'lucide-react';
import { useCreativeBriefs, useBriefMutations } from '@/hooks/useCreativeBriefs';
import { BriefSubmissionForm } from '@/components/creative/BriefSubmissionForm';
import { BriefKanban } from '@/components/creative/BriefKanban';
import { BriefDetailPanel } from '@/components/creative/BriefDetailPanel';
import { DesignerWorkspace } from '@/components/creative/DesignerWorkspace';
import { TraffickingQueue } from '@/components/creative/TraffickingQueue';
import { HoursDashboard } from '@/components/creative/HoursDashboard';

export default function CreativePage() {
  const { activeClient } = useClient();
  const { isDesigner, isAdmin } = useAuth();
  const { data: briefs = [] } = useCreativeBriefs();
  const { updateStatus } = useBriefMutations();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = briefs.find((b: any) => b.id === selectedId);

  if (!activeClient) {
    return <div className="flex h-full items-center justify-center"><p className="text-muted-foreground">Select a client</p></div>;
  }

  // Designer gets their own workspace
  if (isDesigner) {
    return (
      <div className="space-y-6">
        <Tabs defaultValue="queue">
          <div className="flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="queue">My Queue</TabsTrigger>
              <TabsTrigger value="hours">Hours</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="queue" className="mt-4">
            <DesignerWorkspace onBriefClick={setSelectedId} />
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
    <div className="space-y-6">
      <Tabs defaultValue="kanban">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Creative Briefing</h1>
            <p className="text-sm text-muted-foreground">{briefs.length} briefs for {activeClient.name}</p>
          </div>
          <div className="flex items-center gap-3">
            <TabsList>
              <TabsTrigger value="kanban">Kanban</TabsTrigger>
              <TabsTrigger value="trafficking">Trafficking</TabsTrigger>
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

        <TabsContent value="trafficking" className="mt-4">
          <TraffickingQueue />
        </TabsContent>

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
        clientId={activeClient.id}
      />
    </div>
  );
}
