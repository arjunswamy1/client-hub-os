import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TeamManagement } from '@/components/admin/TeamManagement';
import { ClientManagement } from '@/components/admin/ClientManagement';
import { AssignmentMatrix } from '@/components/admin/AssignmentMatrix';

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
          <TabsTrigger value="activity">Activity</TabsTrigger>
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
        <TabsContent value="activity">
          <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
            Activity log will be available when login events are migrated from the existing codebase.
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
