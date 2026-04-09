import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Settings as SettingsIcon, Link2, Slack, Mail, Phone, FileText, BarChart3 } from 'lucide-react';

const INTEGRATIONS = [
  { name: 'Slack', icon: Slack, description: 'Channel messages for client communication', connected: false },
  { name: 'Microsoft Teams', icon: Link2, description: 'Teams channel messages', connected: false },
  { name: 'Gmail', icon: Mail, description: 'Email threads tagged per client', connected: false },
  { name: 'Fathom', icon: Phone, description: 'Call recordings & transcripts', connected: false },
  { name: 'Google Drive', icon: FileText, description: 'Shared folders and documents', connected: false },
  { name: 'Meta Ads', icon: BarChart3, description: 'Campaign performance data', connected: false },
  { name: 'Google Ads', icon: BarChart3, description: 'Campaign performance data', connected: false },
];

export default function SettingsPage() {
  const { activeClient } = useClient();
  const { isAdmin } = useAuth();

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          {activeClient ? `Settings for ${activeClient.name}` : 'Global settings'}
        </p>
      </div>

      {/* Integrations */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Link2 className="h-4 w-4" /> Integrations
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {INTEGRATIONS.map((integration) => (
            <div key={integration.name} className="flex items-center justify-between rounded-lg border p-3">
              <div className="flex items-center gap-3">
                <div className="rounded-md bg-accent p-2">
                  <integration.icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium">{integration.name}</p>
                  <p className="text-xs text-muted-foreground">{integration.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={integration.connected ? 'default' : 'secondary'} className="text-[10px]">
                  {integration.connected ? 'Connected' : 'Not connected'}
                </Badge>
                {isAdmin && (
                  <Button variant="outline" size="sm" className="text-xs">
                    {integration.connected ? 'Configure' : 'Connect'}
                  </Button>
                )}
              </div>
            </div>
          ))}
          {!isAdmin && (
            <p className="text-xs text-muted-foreground mt-2">
              Only admins can manage integrations. Contact your admin to connect services.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
