import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useClient } from '@/contexts/ClientContext';
import DashboardPage from './DashboardPage';
import NotFound from './NotFound';

/**
 * Slug-based dashboard route: /jacuzzi, /4js, /dashboard/jacuzzi, ...
 * Syncs the URL slug with the active client so client dashboards are directly linkable.
 */
export default function ClientDashboardRoute() {
  const { clientSlug } = useParams<{ clientSlug: string }>();
  const { clients, activeClient, setActiveClient, isLoading } = useClient();
  const navigate = useNavigate();

  const slug = (clientSlug || '').toLowerCase();
  const match = clients.find((c) => c.slug.toLowerCase() === slug);

  useEffect(() => {
    if (match && activeClient?.id !== match.id) {
      setActiveClient(match);
    }
  }, [match?.id, activeClient?.id]);

  // If the user switches clients from the header while on a slug URL, follow along
  useEffect(() => {
    if (match && activeClient && activeClient.id !== match.id) {
      navigate(`/${activeClient.slug}`, { replace: true });
    }
  }, [activeClient?.id]);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!match) return <NotFound />;

  return <DashboardPage />;
}
