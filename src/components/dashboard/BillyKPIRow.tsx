import KPICard from "@/components/dashboard/KPICard";

interface BillyKPIs {
  spend: number;
  revenue: number;
  conversions: number;
  cac: number;
  roas: number;
  changes: {
    spend: number | null;
    revenue: number | null;
    conversions: number | null;
    cac: number | null;
  };
}

export default function BillyKPIRow({ kpis }: { kpis: BillyKPIs | undefined | null }) {
  if (!kpis) return null;

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
      <KPICard title="Total Spend" value={`$${kpis.spend.toLocaleString()}`} change={kpis.changes.spend} invertColor />
      <KPICard title="Revenue" value={`$${kpis.revenue.toLocaleString()}`} change={kpis.changes.revenue} />
      <KPICard title="Conversions" value={kpis.conversions.toLocaleString()} change={kpis.changes.conversions} />
      <KPICard title="CAC" value={kpis.cac ? `$${kpis.cac}` : "—"} change={kpis.changes.cac} invertColor />
      <KPICard title="ROAS" value={kpis.roas ? `${kpis.roas}x` : "—"} />
    </div>
  );
}
