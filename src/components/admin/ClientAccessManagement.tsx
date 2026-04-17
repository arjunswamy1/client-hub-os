import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Plus, Send, Trash2, UserX } from 'lucide-react';

export function ClientAccessManagement() {
  const { teamMember } = useAuth();
  const qc = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [clientId, setClientId] = useState('');
  const [role, setRole] = useState('viewer');

  const { data: clients = [] } = useQuery({
    queryKey: ['admin-clients-list'],
    queryFn: async () => {
      const { data } = await supabase.from('clients').select('id, name').order('name');
      return data || [];
    },
  });

  const { data: clientUsers = [], isLoading: loadingUsers } = useQuery({
    queryKey: ['admin-client-users'],
    queryFn: async () => {
      const { data } = await supabase
        .from('client_users')
        .select('*, clients(name)');
      return data || [];
    },
  });

  const { data: invites = [] } = useQuery({
    queryKey: ['admin-client-invites'],
    queryFn: async () => {
      const { data } = await supabase
        .from('client_invites')
        .select('*, clients(name)')
        .order('created_at', { ascending: false });
      return data || [];
    },
  });

  const sendInvite = useMutation({
    mutationFn: async () => {
      if (!email || !clientId) throw new Error('Email and client required');
      const { error } = await supabase.from('client_invites').insert({
        email,
        client_id: clientId,
        role,
        invited_by_id: teamMember?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Invite sent');
      setInviteOpen(false);
      setEmail('');
      setClientId('');
      setRole('viewer');
      qc.invalidateQueries({ queryKey: ['admin-client-invites'] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const revokeInvite = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('client_invites').update({ status: 'revoked' }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Invite revoked'); qc.invalidateQueries({ queryKey: ['admin-client-invites'] }); },
  });

  const resendInvite = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('client_invites').update({
        status: 'pending',
        expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Invite resent'); qc.invalidateQueries({ queryKey: ['admin-client-invites'] }); },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Client Portal Access</h3>
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="mr-1.5 h-3.5 w-3.5" />Invite Client User</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Invite Client User</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="skip@billy.com" type="email" />
              </div>
              <div className="space-y-1.5">
                <Label>Client</Label>
                <Select value={clientId} onValueChange={setClientId}>
                  <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                  <SelectContent>
                    {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="viewer">Viewer (read-only)</SelectItem>
                    <SelectItem value="client_admin">Client Admin (can invite others)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={() => sendInvite.mutate()} disabled={sendInvite.isPending} className="w-full">
                <Send className="mr-1.5 h-3.5 w-3.5" />
                {sendInvite.isPending ? 'Sending...' : 'Send Invite'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Active Users */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-muted-foreground">Active Users</h4>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Added</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clientUsers.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-6">No client users yet</TableCell></TableRow>
              ) : clientUsers.map((u: any) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.display_name || u.user_id?.slice(0, 8)}</TableCell>
                  <TableCell>{u.clients?.name || '—'}</TableCell>
                  <TableCell><Badge variant="secondary" className="text-[10px]">{u.client_role || 'viewer'}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(u.created_at).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Pending Invites */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-muted-foreground">Invites</h4>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invites.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">No invites</TableCell></TableRow>
              ) : invites.map((inv: any) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-medium">{inv.email}</TableCell>
                  <TableCell>{inv.clients?.name || '—'}</TableCell>
                  <TableCell><Badge variant="secondary" className="text-[10px]">{inv.role}</Badge></TableCell>
                  <TableCell>
                    <Badge
                      variant={inv.status === 'pending' ? 'outline' : inv.status === 'accepted' ? 'default' : 'destructive'}
                      className="text-[10px]"
                    >
                      {inv.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {inv.status === 'pending' && (
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => resendInvite.mutate(inv.id)}>
                          Resend
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => revokeInvite.mutate(inv.id)}>
                          Revoke
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
