import { useClient } from '@/contexts/ClientContext';
import { useAuth } from '@/contexts/AuthContext';
import { CheckSquare, Phone, AlertTriangle, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function DashboardPage() {
  const { activeClient } = useClient();
  const { teamMember } = useAuth();

  if (!activeClient) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Select a client to view their dashboard</p>
      </div>
    );
  }

  const stats = [
    { label: 'Active Tasks', value: '—', icon: CheckSquare, color: 'text-primary' },
    { label: 'Overdue', value: '—', icon: AlertTriangle, color: 'text-destructive' },
    { label: 'Pending Approvals', value: '—', icon: Clock, color: 'text-warning' },
    { label: 'Hours This Week', value: '—', icon: Clock, color: 'text-success' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{activeClient.name}</h1>
        <p className="text-sm text-muted-foreground">Client overview and recent activity</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="flex items-center gap-4 p-5">
              <div className={`rounded-lg bg-accent p-2.5 ${stat.color}`}>
                <stat.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Activity feed will populate as you start creating tasks, agendas, and briefs.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Upcoming</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Upcoming deadlines and scheduled calls will appear here.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
