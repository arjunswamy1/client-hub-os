import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LinkIcon, Loader2, CheckCircle2, KeyRound } from 'lucide-react';
import { GoogleAdsIcon, MetaIcon, SlackIcon, TeamsIcon, GmailIcon, FathomIcon, GoogleDriveIcon } from '@/components/icons/BrandIcons';
import { GoogleAdsAccountPicker } from '@/components/settings/GoogleAdsAccountPicker';
import { MetaSyncAccountsPicker } from '@/components/settings/MetaSyncAccountsPicker';
import { toast } from 'sonner';

type Integration = {
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  platform?: 'google' | 'meta';
};

const INTEGRATIONS: Integration[] = [
  { name: 'Google Ads', icon: GoogleAdsIcon, description: 'Campaign performance data', platform: 'google' },
  { name: 'Meta Ads', icon: MetaIcon, description: 'Campaign performance data', platform: 'meta' },
  { name: 'Slack', icon: SlackIcon, description: 'Channel messages for client communication' },
  { name: 'Microsoft Teams', icon: TeamsIcon, description: 'Teams channel messages' },
  { name: 'Gmail', icon: GmailIcon, description: 'Email threads tagged per client' },
  { name: 'Fathom', icon: FathomIcon, description: 'Call recordings & transcripts' },
  { name: 'Google Drive', icon: GoogleDriveIcon, description: 'Shared folders and documents' },
];

function ChangePasswordCard() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }
    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success('Password updated successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to update password');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <KeyRound className="h-4 w-4" /> Change Password
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="new-password">New Password</Label>
          <Input
            id="new-password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Enter new password"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm-password">Confirm New Password</Label>
          <Input
            id="confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
          />
        </div>
        <Button onClick={handleChangePassword} disabled={saving || !newPassword || !confirmPassword}>
          {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
          Update Password
        </Button>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const { activeClient } = useClient();
  const { isAdmin, user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [connectedPlatforms, setConnectedPlatforms] = useState<Set<string>>(new Set());
  const [connecting, setConnecting] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Show toast from OAuth callback redirect
  useEffect(() => {
    const connected = searchParams.get('connected');
    const error = searchParams.get('error');
    if (connected) {
      toast.success(`${connected === 'google' ? 'Google Ads' : 'Meta Ads'} connected successfully!`);
      searchParams.delete('connected');
      searchParams.delete('client_id');
      setSearchParams(searchParams, { replace: true });
    }
    if (error) {
      toast.error(`OAuth error: ${error}`);
      searchParams.delete('error');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Fetch existing connections
  useEffect(() => {
    async function fetchConnections() {
      if (!activeClient) {
        setConnectedPlatforms(new Set());
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from('platform_connections_safe')
        .select('platform, status')
        .eq('client_id', activeClient.id)
        .eq('status', 'active');

      const platforms = new Set((data || []).map((c) => c.platform));
      setConnectedPlatforms(platforms);
      setLoading(false);
    }
    fetchConnections();
  }, [activeClient]);

  const handleConnect = async (platform: 'google' | 'meta') => {
    if (!activeClient) {
      toast.error('Please select a client first');
      return;
    }
    setConnecting(platform);
    try {
      const functionName = platform === 'google' ? 'google-oauth-initiate' : 'meta-oauth-initiate';
      const { data, error } = await supabase.functions.invoke(functionName, {
        body: { client_id: activeClient.id },
      });

      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error('No redirect URL returned');
      }
    } catch (err: any) {
      toast.error(`Failed to start ${platform} OAuth: ${err.message}`);
      setConnecting(null);
    }
  };

  const handleDisconnect = async (platform: string) => {
    if (!activeClient) return;
    const { error } = await supabase
      .from('platform_connections')
      .update({ status: 'disconnected' })
      .eq('client_id', activeClient.id)
      .eq('platform', platform);

    if (error) {
      toast.error('Failed to disconnect');
    } else {
      setConnectedPlatforms((prev) => {
        const next = new Set(prev);
        next.delete(platform);
        return next;
      });
      toast.success(`${platform === 'google' ? 'Google Ads' : 'Meta Ads'} disconnected`);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          {activeClient ? `Settings for ${activeClient.name}` : 'Global settings'}
        </p>
      </div>

      <ChangePasswordCard />

      {isAdmin && (
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-sm font-medium">Agent tokens</p>
              <p className="text-xs text-muted-foreground">Keys that let Claude agents read the hub and write drafts.</p>
            </div>
            <Button variant="outline" size="sm" asChild><a href="/settings/agent-tokens">Manage</a></Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <LinkIcon className="h-4 w-4" /> Integrations
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {INTEGRATIONS.map((integration) => {
            const isConnected = integration.platform ? connectedPlatforms.has(integration.platform) : false;
            const isConnecting = connecting === integration.platform;

            return (
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
                  <Badge variant={isConnected ? 'default' : 'secondary'} className="text-[10px]">
                    {isConnected ? (
                      <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Connected</span>
                    ) : 'Not connected'}
                  </Badge>
                  {isAdmin && integration.platform && (
                    isConnected ? (
                      <Button variant="outline" size="sm" className="text-xs" onClick={() => handleDisconnect(integration.platform!)}>
                        Disconnect
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        className="text-xs"
                        disabled={isConnecting || !activeClient}
                        onClick={() => handleConnect(integration.platform!)}
                      >
                        {isConnecting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                        Connect
                      </Button>
                    )
                  )}
                </div>
              </div>
            );
          })}
          {!isAdmin && (
            <p className="text-xs text-muted-foreground mt-2">
              Only admins can manage integrations. Contact your admin to connect services.
            </p>
          )}
        </CardContent>
      </Card>

      {isAdmin && activeClient && connectedPlatforms.has('google') && (
        <GoogleAdsAccountPicker clientId={activeClient.id} />
      )}

      {isAdmin && activeClient && connectedPlatforms.has('meta') && (
        <MetaSyncAccountsPicker clientId={activeClient.id} />
      )}
    </div>
  );
}
