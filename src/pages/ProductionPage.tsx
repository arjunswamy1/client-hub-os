import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ShootBriefsList } from '@/components/production/ShootBriefsList';
import { ActorDatabase } from '@/components/production/ActorDatabase';
import { LocationsDatabase } from '@/components/production/LocationsDatabase';
import { ProductionCalendar } from '@/components/production/ProductionCalendar';
import { ProductionAuditLog } from '@/components/production/ProductionAuditLog';
import { Film } from 'lucide-react';

export default function ProductionPage() {
  const [tab, setTab] = useState('briefs');
  return (
    <div className="container mx-auto py-6 px-4 max-w-7xl">
      <div className="flex items-center gap-3 mb-6">
        <Film className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">Production</h1>
          <p className="text-sm text-muted-foreground">Video shoot pipeline — briefs, talent, locations, calendar</p>
        </div>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid grid-cols-5 max-w-3xl">
          <TabsTrigger value="briefs">Shoot Briefs</TabsTrigger>
          <TabsTrigger value="actors">Actor Database</TabsTrigger>
          <TabsTrigger value="locations">Locations</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
        </TabsList>
        <div className="mt-6">
          <TabsContent value="briefs"><ShootBriefsList /></TabsContent>
          <TabsContent value="actors"><ActorDatabase /></TabsContent>
          <TabsContent value="locations"><LocationsDatabase /></TabsContent>
          <TabsContent value="calendar"><ProductionCalendar /></TabsContent>
          <TabsContent value="audit"><ProductionAuditLog /></TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
