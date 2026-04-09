import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

export function AssignmentMatrix() {
  const queryClient = useQueryClient();

  const { data: clients = [] } = useQuery({
    queryKey: ['all_clients'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('*').order('name');
      if (error) throw error;
      return data;
    },
  });

  const { data: ams = [] } = useQuery({
    queryKey: ['account_managers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('team_members')
        .select('*')
        .in('role', ['account_manager', 'designer'])
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  const { data: assignments = [] } = useQuery({
    queryKey: ['all_assignments'],
    queryFn: async () => {
      const { data, error } = await supabase.from('client_assignments').select('*');
      if (error) throw error;
      return data;
    },
  });

  const toggleAssignment = useMutation({
    mutationFn: async ({ clientId, memberId, assigned }: { clientId: string; memberId: string; assigned: boolean }) => {
      if (assigned) {
        const { error } = await supabase.from('client_assignments')
          .delete()
          .eq('client_id', clientId)
          .eq('team_member_id', memberId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('client_assignments').insert({
          client_id: clientId,
          team_member_id: memberId,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all_assignments'] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const isAssigned = (clientId: string, memberId: string) =>
    assignments.some((a: any) => a.client_id === clientId && a.team_member_id === memberId);

  const getCount = (memberId: string) =>
    assignments.filter((a: any) => a.team_member_id === memberId).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Client-Team Assignment Matrix</CardTitle>
        <div className="flex gap-3 mt-2">
          {ams.map((am: any) => (
            <Badge key={am.id} variant="secondary" className="text-xs">
              {am.name}: {getCount(am.id)} client{getCount(am.id) !== 1 ? 's' : ''}
            </Badge>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-4 text-left font-medium text-muted-foreground">Client</th>
                {ams.map((am: any) => (
                  <th key={am.id} className="px-3 py-2 text-center font-medium text-muted-foreground text-xs">
                    {am.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clients.map((client: any) => (
                <tr key={client.id} className="border-b last:border-0">
                  <td className="py-2.5 pr-4 font-medium">{client.name}</td>
                  {ams.map((am: any) => {
                    const assigned = isAssigned(client.id, am.id);
                    return (
                      <td key={am.id} className="px-3 py-2.5 text-center">
                        <Checkbox
                          checked={assigned}
                          onCheckedChange={() =>
                            toggleAssignment.mutate({ clientId: client.id, memberId: am.id, assigned })
                          }
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
              {clients.length === 0 && (
                <tr>
                  <td colSpan={ams.length + 1} className="py-8 text-center text-muted-foreground">
                    No clients yet. Add clients first.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
