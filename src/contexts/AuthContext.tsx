import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { TeamMember } from '@/types';

interface ClientUserRecord {
  id: string;
  client_id: string;
  user_id: string;
  display_name: string | null;
  client_role: string;
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  teamMember: TeamMember | null;
  clientUser: ClientUserRecord | null;
  isLoading: boolean;
  isAdmin: boolean;
  isAccountManager: boolean;
  isDesigner: boolean;
  isClientUser: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [teamMember, setTeamMember] = useState<TeamMember | null>(null);
  const [clientUser, setClientUser] = useState<ClientUserRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setTeamMember(null);
      setClientUser(null);
      return;
    }

    const fetchUserRole = async () => {
      // Check team_members first (internal users)
      if (user.email) {
        const { data: tm } = await supabase
          .from('team_members')
          .select('*')
          .eq('email', user.email)
          .eq('is_active', true)
          .maybeSingle();
        
        if (tm) {
          setTeamMember(tm as TeamMember);
          setClientUser(null);
          return;
        }
      }

      // Check client_users (external client portal users)
      const { data: cu } = await supabase
        .from('client_users')
        .select('id, client_id, user_id, display_name, client_role')
        .eq('user_id', user.id)
        .maybeSingle();

      setTeamMember(null);
      setClientUser(cu as ClientUserRecord | null);
    };

    fetchUserRole();
  }, [user?.id, user?.email]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const isAdmin = teamMember?.role === 'admin';
  const isAccountManager = teamMember?.role === 'account_manager';
  const isDesigner = teamMember?.role === 'designer';
  const isClientUser = !!clientUser && !teamMember;

  return (
    <AuthContext.Provider value={{
      session, user, teamMember, clientUser, isLoading,
      isAdmin, isAccountManager, isDesigner, isClientUser, signOut
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
