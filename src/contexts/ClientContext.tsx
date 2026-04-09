import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './AuthContext';
import { Client } from '@/types';

interface ClientContextType {
  clients: Client[];
  activeClient: Client | null;
  setActiveClient: (client: Client) => void;
  isLoading: boolean;
}

const ClientContext = createContext<ClientContextType | undefined>(undefined);

export function ClientProvider({ children }: { children: ReactNode }) {
  const { teamMember, isAdmin, user } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [activeClient, setActiveClient] = useState<Client | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setClients([]);
      setActiveClient(null);
      setIsLoading(false);
      return;
    }

    const fetchClients = async () => {
      setIsLoading(true);
      let query;

      if (isAdmin) {
        // Admins see all clients
        query = supabase.from('clients').select('*').order('name');
      } else if (teamMember) {
        // AMs/Designers see only assigned clients
        const { data: assignments } = await supabase
          .from('client_assignments')
          .select('client_id')
          .eq('team_member_id', teamMember.id);

        const clientIds = assignments?.map(a => a.client_id) || [];
        if (clientIds.length === 0) {
          setClients([]);
          setActiveClient(null);
          setIsLoading(false);
          return;
        }
        query = supabase.from('clients').select('*').in('id', clientIds).order('name');
      } else {
        // External client users — will use client_members table when migrated
        setClients([]);
        setIsLoading(false);
        return;
      }

      const { data } = await query;
      const clientList = (data as Client[]) || [];
      setClients(clientList);

      // Restore last active client or pick first
      const lastClientId = localStorage.getItem('cpm_active_client');
      const restored = clientList.find(c => c.id === lastClientId);
      setActiveClient(restored || clientList[0] || null);
      setIsLoading(false);
    };

    fetchClients();
  }, [user, teamMember, isAdmin]);

  const handleSetActiveClient = (client: Client) => {
    setActiveClient(client);
    localStorage.setItem('cpm_active_client', client.id);
  };

  return (
    <ClientContext.Provider value={{
      clients, activeClient, setActiveClient: handleSetActiveClient, isLoading
    }}>
      {children}
    </ClientContext.Provider>
  );
}

export function useClient() {
  const ctx = useContext(ClientContext);
  if (!ctx) throw new Error('useClient must be used within ClientProvider');
  return ctx;
}
