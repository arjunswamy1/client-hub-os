import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ClientProvider } from "@/contexts/ClientContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import AuthPage from "./pages/AuthPage";
import DashboardPage from "./pages/DashboardPage";
import TasksPage from "./pages/TasksPage";
import AgendasPage from "./pages/AgendasPage";
import CreativePage from "./pages/CreativePage";
import ContextPage from "./pages/ContextPage";
import AIAssistantPage from "./pages/AIAssistantPage";
import LandingPagesPage from "./pages/LandingPagesPage";
// TraffickingPage moved into CreativePage tabs
import SettingsPage from "./pages/SettingsPage";
import TeamPage from "./pages/TeamPage";
import AdminPage from "./pages/AdminPage";
import AdminClientCostsPage from "./pages/AdminClientCostsPage";
import AMHomePage from "./pages/AMHomePage";
import CampaignBuildPage from "./pages/CampaignBuildPage";
import NotFound from "./pages/NotFound";
import OnboardingPage from "./pages/OnboardingPage";
import DemoPage from "./pages/DemoPage";
import DemoDashboardPage from "./pages/DemoDashboardPage";
import SignupPage from "./pages/SignupPage";
import ClientPortalPage from "./pages/ClientPortalPage";
import UnsubscribePage from "./pages/UnsubscribePage";
import ProductionPage from "./pages/ProductionPage";
import TalentApplyPage from "./pages/TalentApplyPage";
import AIVideoStudioPage from "./pages/AIVideoStudioPage";

const queryClient = new QueryClient();

function ForcePasswordChange() {
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirm) { toast.error('Passwords do not match'); return; }
    if (newPassword.length < 8) { toast.error('Min 8 characters'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
        data: { must_change_password: false },
      });
      if (error) throw error;
      toast.success('Password updated!');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-lg space-y-4">
        <h2 className="text-lg font-semibold">Change Your Password</h2>
        <p className="text-sm text-muted-foreground">You must set a new password before continuing.</p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input type="password" placeholder="New password" value={newPassword}
            onChange={e => setNewPassword(e.target.value)} required minLength={8}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
          <input type="password" placeholder="Confirm password" value={confirm}
            onChange={e => setConfirm(e.target.value)} required minLength={8}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
          <button type="submit" disabled={saving}
            className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {saving ? 'Updating...' : 'Set New Password'}
          </button>
        </form>
      </div>
    </div>
  );
}

function ProtectedRoutes() {
  const { session, user, isLoading, isAdmin, isAccountManager, isClientUser, clientUser } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!session) return <Navigate to="/auth" replace />;

  if (user?.user_metadata?.must_change_password) {
    return <ForcePasswordChange />;
  }

  // Client portal users get a completely different layout
  if (isClientUser) {
    return (
      <ClientProvider>
        <ClientPortalPage />
      </ClientProvider>
    );
  }

  return (
    <ClientProvider>
      <AppLayout>
        <Routes>
          <Route path="/" element={
            isAccountManager ? <AMHomePage /> : <Navigate to="/dashboard" replace />
          } />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/agendas" element={<AgendasPage />} />
          <Route path="/creative" element={<CreativePage />} />
          <Route path="/landing-pages" element={<LandingPagesPage />} />
          <Route path="/trafficking" element={<Navigate to="/creative" replace />} />
          <Route path="/context" element={<ContextPage />} />
          <Route path="/ai" element={<AIAssistantPage />} />
          <Route path="/campaign-build" element={<CampaignBuildPage />} />
          <Route path="/production" element={<ProductionPage />} />
          <Route path="/ai-video" element={<AIVideoStudioPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/team" element={<TeamPage />} />
          {isAdmin && <Route path="/admin" element={<AdminPage />} />}
          {isAdmin && <Route path="/admin/costs/:clientId" element={<AdminClientCostsPage />} />}
          <Route path="/client-portal-preview" element={<ClientPortalPage isAdminPreview adminName={user?.email || 'Admin'} />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AppLayout>
    </ClientProvider>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/demo" element={<DemoPage />} />
            <Route path="/demo/dashboard" element={<DemoDashboardPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/unsubscribe" element={<UnsubscribePage />} />
            <Route path="/talent-apply" element={<TalentApplyPage />} />
            <Route path="/onboarding/:token" element={<OnboardingPage />} />
            <Route path="/*" element={<ProtectedRoutes />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
