import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { TeamMember } from '@/types';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  teamMember: TeamMember | null;
  isLoading: boolean;
  isAdmin: boolean;
  isAccountManager: boolean;
  isDesigner: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [teamMember, setTeamMember] = useState<TeamMember | null>(null);
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
    if (!user?.email) {
      setTeamMember(null);
      return;
    }

    const fetchTeamMember = async () => {
      const { data } = await supabase
        .from('team_members')
        .select('*')
        .eq('email', user.email!)
        .eq('is_active', true)
        .maybeSingle();
      
      setTeamMember(data as TeamMember | null);
    };

    fetchTeamMember();
  }, [user?.email]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const isAdmin = teamMember?.role === 'admin';
  const isAccountManager = teamMember?.role === 'account_manager';
  const isDesigner = teamMember?.role === 'designer';

  return (
    <AuthContext.Provider value={{
      session, user, teamMember, isLoading,
      isAdmin, isAccountManager, isDesigner, signOut
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
