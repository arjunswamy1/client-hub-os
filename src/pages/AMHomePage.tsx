import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { Card, CardContent } from '@/components/ui/card';
import { useNavigate } from 'react-router-dom';
import { Circle, ArrowRight } from 'lucide-react';

export default function AMHomePage() {
  const { teamMember } = useAuth();
  const { clients, setActiveClient } = useClient();
  const navigate = useNavigate();

  const handleClientClick = (client: any) => {
    setActiveClient(client);
    navigate('/dashboard');
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome back, {teamMember?.name?.split(' ')[0] || 'there'}
        </h1>
        <p className="text-sm text-muted-foreground">
          {clients.length} client{clients.length !== 1 ? 's' : ''} assigned to you
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {clients.map((client) => (
          <Card
            key={client.id}
            className="cursor-pointer transition-all hover:shadow-md hover:ring-1 hover:ring-primary/20"
            onClick={() => handleClientClick(client)}
          >
            <CardContent className="flex items-center justify-between p-5">
              <div className="flex items-center gap-3">
                <Circle
                  className="h-3 w-3 shrink-0 fill-current"
                  style={{ color: client.color || 'hsl(220, 70%, 50%)' }}
                />
                <div>
                  <p className="font-medium">{client.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">{client.status}</p>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
