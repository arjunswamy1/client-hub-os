import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

export default function TeamPage() {
  const { teamMember: currentMember } = useAuth();

  const { data: members = [] } = useQuery({
    queryKey: ['team_members'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('team_members')
        .select('*')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  const roleColors: Record<string, string> = {
    admin: 'bg-primary/10 text-primary',
    account_manager: 'bg-blue-100 text-blue-700',
    designer: 'bg-purple-100 text-purple-700',
    client: 'bg-green-100 text-green-700',
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
        <p className="text-sm text-muted-foreground">{members.length} active members</p>
      </div>

      <div className="space-y-2">
        {members.map((m: any) => (
          <Card key={m.id}>
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <Avatar className="h-9 w-9">
                  <AvatarFallback className="bg-primary/10 text-sm text-primary">
                    {m.name.split(' ').map((n: string) => n[0]).join('').toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{m.name}</p>
                    {m.id === currentMember?.id && (
                      <Badge variant="outline" className="text-[10px]">You</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{m.email}</p>
                </div>
              </div>
              <Badge variant="secondary" className={`text-[10px] ${roleColors[m.role] || ''}`}>
                {m.role.replace('_', ' ')}
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
