import { ArrowUpRight, ArrowDownRight } from "lucide-react";

export interface KPICardProps {
  title: string;
  value: string;
  change?: number | null;
  invertColor?: boolean;
  subtitle?: string;
}

const KPICard = ({ title, value, change, invertColor, subtitle }: KPICardProps) => {
  const hasChange = change !== undefined && change !== null;
  const isPositive = invertColor ? (change ?? 0) <= 0 : (change ?? 0) >= 0;

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
          {subtitle && <p className="text-[10px] text-muted-foreground/70">{subtitle}</p>}
        </div>
      </div>
      <div className="mt-3 flex items-end gap-2">
        <p className="text-2xl font-bold tracking-tight text-foreground">{value}</p>
        {hasChange && (
          <div className={`flex items-center gap-0.5 text-xs font-medium ${isPositive ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
            {isPositive ? (
              <ArrowUpRight className="h-3.5 w-3.5" />
            ) : (
              <ArrowDownRight className="h-3.5 w-3.5" />
            )}
            <span>{change! >= 0 ? "+" : ""}{change}%</span>
            <span className="ml-0.5 text-muted-foreground font-normal">vs prev</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default KPICard;
