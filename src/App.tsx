import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ClientProvider } from "@/contexts/ClientContext";
import { AppLayout } from "@/components/layout/AppLayout";
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
import AMHomePage from "./pages/AMHomePage";
import CampaignBuildPage from "./pages/CampaignBuildPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function ProtectedRoutes() {
  const { session, isLoading, isAdmin, isAccountManager } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!session) return <Navigate to="/auth" replace />;

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
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/team" element={<TeamPage />} />
          {isAdmin && <Route path="/admin" element={<AdminPage />} />}
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
            <Route path="/*" element={<ProtectedRoutes />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
