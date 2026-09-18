import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TeamManagement } from '@/components/admin/TeamManagement';
import { ClientManagement } from '@/components/admin/ClientManagement';
import { AssignmentMatrix } from '@/components/admin/AssignmentMatrix';
import { ClientOnboardingView } from '@/components/admin/ClientOnboardingView';
import { ClientAccessManagement } from '@/components/admin/ClientAccessManagement';
import { TechCostsOverview } from '@/components/admin/TechCostsOverview';
import { DataIntegrityExceptions } from '@/components/admin/DataIntegrityExceptions';

export default function AdminPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin Panel</h1>
        <p className="text-sm text-muted-foreground">Manage team, clients, and assignments</p>
      </div>

      <Tabs defaultValue="team" className="space-y-4">
        <TabsList>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="clients">Clients</TabsTrigger>
          <TabsTrigger value="assignments">Assignments</TabsTrigger>
          <TabsTrigger value="client-access">Client Access</TabsTrigger>
          <TabsTrigger value="onboarding">Onboarding</TabsTrigger>
          <TabsTrigger value="costs">Tech Costs</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="integrity">Data Integrity</TabsTrigger>
        </TabsList>


        <TabsContent value="team">
          <TeamManagement />
        </TabsContent>
        <TabsContent value="clients">
          <ClientManagement />
        </TabsContent>
        <TabsContent value="assignments">
          <AssignmentMatrix />
        </TabsContent>
        <TabsContent value="client-access">
          <ClientAccessManagement />
        </TabsContent>
        <TabsContent value="onboarding">
          <ClientOnboardingView />
        </TabsContent>
        <TabsContent value="costs">
          <TechCostsOverview />
        </TabsContent>
        <TabsContent value="integrity">
          <DataIntegrityExceptions />
        </TabsContent>
        <TabsContent value="activity">

          <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
            Activity log will be available when login events are migrated from the existing codebase.
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

