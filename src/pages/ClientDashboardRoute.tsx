import { useEffect, useRef } from 'react';
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
  const syncedSlug = useRef<string | null>(null);

  const slug = (clientSlug || '').toLowerCase();
  const match = clients.find((c) => c.slug.toLowerCase() === slug);

  useEffect(() => {
    if (!match) return;
    if (syncedSlug.current !== slug) {
      // URL is the source of truth on entry / slug change
      if (activeClient?.id !== match.id) setActiveClient(match);
      syncedSlug.current = slug;
      return;
    }
    // Already synced: a client switch from the header should update the URL
    if (activeClient && activeClient.id !== match.id) {
      syncedSlug.current = activeClient.slug.toLowerCase();
      navigate(`/${activeClient.slug}`, { replace: true });
    }
  }, [slug, match?.id, activeClient?.id]);

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
