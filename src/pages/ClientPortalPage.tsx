import { useState } from 'react';
import { DateRangeProvider } from '@/contexts/DateRangeContext';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { LiveAdsView } from '@/components/portal/LiveAdsView';
import DashboardPage from './DashboardPage';

interface ClientPortalPageProps {
  isAdminPreview?: boolean;
  adminName?: string;
}

export default function ClientPortalPage({ isAdminPreview, adminName }: ClientPortalPageProps) {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'live-ads'>('live-ads');

  return (
    <DateRangeProvider>
      <PortalLayout
        activeTab={activeTab}
        onTabChange={setActiveTab}
        isAdminPreview={isAdminPreview}
        adminName={adminName}
      >
        {activeTab === 'dashboard' ? <DashboardPage /> : <LiveAdsView />}
      </PortalLayout>
    </DateRangeProvider>
  );
}
