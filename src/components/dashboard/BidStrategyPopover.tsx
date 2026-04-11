import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Info } from "lucide-react";

interface Props {
  strategy: string | null;
  details?: Record<string, any> | null;
}

const strategyLabels: Record<string, string> = {
  TARGET_CPA: "Target CPA",
  MAXIMIZE_CONVERSIONS: "Max Conv.",
  MAXIMIZE_CONVERSION_VALUE: "Max Value",
  TARGET_ROAS: "Target ROAS",
  MANUAL_CPC: "Manual CPC",
  MAXIMIZE_CLICKS: "Max Clicks",
  TARGET_SPEND: "Target Spend",
};

export default function BidStrategyPopover({ strategy, details }: Props) {
  if (!strategy) return <span className="text-muted-foreground">—</span>;

  const label = strategyLabels[strategy] || strategy.replace(/_/g, " ");
  const hasDetails = details && Object.keys(details).length > 0;

  if (!hasDetails) {
    return <Badge variant="outline" className="text-xs">{label}</Badge>;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Badge variant="outline" className="cursor-pointer gap-1 text-xs hover:bg-accent">
          {label}
          <Info className="h-3 w-3" />
        </Badge>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3" align="start">
        <p className="mb-2 text-xs font-semibold">{label} Details</p>
        <div className="space-y-1.5 text-xs">
          {details.maxCpcBidCeiling != null && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Max CPC</span>
              <span className="font-medium">${Number(details.maxCpcBidCeiling).toFixed(2)}</span>
            </div>
          )}
          {details.targetCpa != null && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Target CPA</span>
              <span className="font-medium">${Number(details.targetCpa).toFixed(2)}</span>
            </div>
          )}
          {details.targetRoas != null && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Target ROAS</span>
              <span className="font-medium">{Number(details.targetRoas).toFixed(1)}x</span>
            </div>
          )}
          {details.targetSpend != null && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Target Spend</span>
              <span className="font-medium">${Number(details.targetSpend).toLocaleString()}</span>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
