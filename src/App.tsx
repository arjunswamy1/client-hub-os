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
import AdminPage from "./pages/AdminPage";
import AMHomePage from "./pages/AMHomePage";
import PlaceholderPage from "./pages/PlaceholderPage";
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
          <Route path="/agendas" element={<PlaceholderPage title="Call Agendas & Notes" />} />
          <Route path="/creative" element={<PlaceholderPage title="Creative Briefing" />} />
          <Route path="/landing-pages" element={<PlaceholderPage title="Landing Pages" />} />
          <Route path="/context" element={<PlaceholderPage title="Context Feed" />} />
          <Route path="/ai" element={<PlaceholderPage title="AI Assistant" />} />
          <Route path="/settings" element={<PlaceholderPage title="Settings" />} />
          <Route path="/team" element={<PlaceholderPage title="Team" />} />
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
