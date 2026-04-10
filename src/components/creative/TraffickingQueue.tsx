
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useClient } from '@/contexts/ClientContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Download, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import { useBriefMutations } from '@/hooks/useCreativeBriefs';

interface Props {
  allClients?: boolean;
}

export function TraffickingQueue({ allClients }: Props) {
  const { activeClient, clients } = useClient();
  const { updateStatus } = useBriefMutations();

  const { data: briefs = [] } = useQuery({
    queryKey: ['trafficking_briefs', allClients ? 'all' : activeClient?.id],
    queryFn: async () => {
      let query = supabase
        .from('creative_briefs')
        .select(`
          *,
          assigned_to:team_members!creative_briefs_assigned_to_id_fkey(name),
          created_by:team_members!creative_briefs_created_by_id_fkey(name),
          client:clients!creative_briefs_client_id_fkey(name, color)
        `)
        .in('status', ['approved', 'delivered'])
        .order('approved_at', { ascending: false });

      if (!allClients && activeClient) {
        query = query.eq('client_id', activeClient.id);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: allClients ? true : !!activeClient,
  });

  const approvedBriefs = briefs.filter((b: any) => b.status === 'approved');
  const deliveredBriefs = briefs.filter((b: any) => b.status === 'delivered');

  return (
    <div className="space-y-6">
      {/* Approved / Ready to Traffic */}
      <div>
        <h3 className="text-sm font-medium mb-3">Ready to Traffic ({approvedBriefs.length})</h3>
        {approvedBriefs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No briefs ready for trafficking.</p>
        ) : (
          <div className="space-y-2">
            {approvedBriefs.map((brief: any) => (
              <Card key={brief.id}>
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {allClients && brief.client && (
                        <Badge variant="outline" className="text-[9px]" style={{ borderColor: brief.client.color }}>
                          {brief.client.name}
                        </Badge>
                      )}
                      <p className="text-sm font-medium truncate">{brief.title}</p>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Approved {brief.approved_at ? format(new Date(brief.approved_at), 'MMM d') : ''} • 
                      Created by {brief.created_by?.name || '—'}
                    </p>
                  </div>
                  <Button size="sm" variant="outline"
                    onClick={() => updateStatus.mutate({ id: brief.id, status: 'delivered' })}
                  >
                    <CheckCircle2 className="h-3 w-3 mr-1" /> Mark Trafficked
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Recently delivered */}
      {deliveredBriefs.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-3 text-muted-foreground">Recently Trafficked ({deliveredBriefs.length})</h3>
          <div className="space-y-2 opacity-70">
            {deliveredBriefs.slice(0, 10).map((brief: any) => (
              <Card key={brief.id}>
                <CardContent className="p-3 flex items-center gap-3">
                  <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{brief.title}</p>
                    <p className="text-[10px] text-muted-foreground">
                      Trafficked {brief.trafficked_at ? format(new Date(brief.trafficked_at), 'MMM d, HH:mm') : ''}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
