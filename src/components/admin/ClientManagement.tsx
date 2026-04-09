import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Plus, Circle } from 'lucide-react';
import { toast } from 'sonner';

export function ClientManagement() {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [color, setColor] = useState('#3B82F6');
  const [commChannel, setCommChannel] = useState('');

  const { data: clients = [] } = useQuery({
    queryKey: ['all_clients'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('*').order('name');
      if (error) throw error;
      return data;
    },
  });

  const addClient = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('clients').insert({
        name,
        slug: slug || name.toLowerCase().replace(/\s+/g, '-'),
        color,
        communication_channel: commChannel || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all_clients'] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      toast.success('Client added');
      setIsDialogOpen(false);
      setName(''); setSlug(''); setColor('#3B82F6'); setCommChannel('');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const statusColors: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    paused: 'bg-yellow-100 text-yellow-700',
    offboarded: 'bg-gray-100 text-gray-500',
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">Clients</CardTitle>
        <Button size="sm" onClick={() => setIsDialogOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />
          Add Client
        </Button>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {clients.map((c: any) => (
            <div key={c.id} className="flex items-center justify-between rounded-lg border p-3">
              <div className="flex items-center gap-3">
                <Circle className="h-3 w-3 fill-current" style={{ color: c.color || '#3B82F6' }} />
                <div>
                  <p className="text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.slug}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {c.communication_channel && (
                  <Badge variant="outline" className="text-[10px]">{c.communication_channel}</Badge>
                )}
                <Badge variant="secondary" className={`text-[10px] ${statusColors[c.status] || ''}`}>
                  {c.status}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </CardContent>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Add Client</DialogTitle></DialogHeader>
          <form onSubmit={e => { e.preventDefault(); addClient.mutate(); }} className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Slug</Label>
              <Input value={slug} onChange={e => setSlug(e.target.value)} placeholder="auto-generated" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Brand Color</Label>
                <Input type="color" value={color} onChange={e => setColor(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Comm Channel</Label>
                <Select value={commChannel} onValueChange={setCommChannel}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="slack">Slack</SelectItem>
                    <SelectItem value="teams">Teams</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={addClient.isPending}>
              {addClient.isPending ? 'Adding...' : 'Add Client'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
