import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, PhoneCall, RefreshCw } from "lucide-react";
import { toast } from "sonner";

type SyncResult = {
  calls_fetched?: number;
  calls_live_campaigns?: number;
  calls_synced?: number;
  calls_with_tags?: number;
  campaigns_kept?: string[];
  warning?: string | null;
  error?: string;
};

const RANGES = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
];

export default function BuyologyRingbaSyncCard() {
  const qc = useQueryClient();
  const [running, setRunning] = useState<number | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);

  const run = async (days: number) => {
    setRunning(days);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("sync-ringba-calls-buyology", {
        body: { days_back: days },
      });
      if (error) throw error;
      const res = data as SyncResult;
      setResult(res);
      if (res.error) {
        toast.error(res.error);
      } else {
        toast.success(`Synced ${res.calls_synced ?? 0} calls from Ringba`);
        qc.invalidateQueries({ queryKey: ["buyology-calls"] });
        qc.invalidateQueries({ queryKey: ["buyology-creative-analysis"] });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Sync failed";
      setResult({ error: msg });
      toast.error(msg);
    } finally {
      setRunning(null);
    }
  };

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <PhoneCall className="mt-0.5 h-4 w-4 text-primary" />
          <div>
            <h3 className="text-sm font-semibold">Ringba call sync</h3>
            <p className="text-xs text-muted-foreground">
              Pulls Walk In Tubs and Bathroom Remodel calls straight from the BuyologyIQ Ringba
              account, including the UTM tags used for creative attribution. Existing calls are
              updated in place, so re-running is safe.
            </p>
          </div>
        </div>
        <Badge variant="secondary" className="whitespace-nowrap text-[10px]">API connected</Badge>
      </div>

      <div className="flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <Button
            key={r.days}
            size="sm"
            variant={r.days === 7 ? "default" : "outline"}
            disabled={running !== null}
            onClick={() => run(r.days)}
          >
            {running === r.days ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            {r.label}
          </Button>
        ))}
      </div>

      {result && !result.error && (
        <div className="space-y-1 rounded-md bg-muted/50 p-3 text-xs">
          <p>
            Fetched <strong>{result.calls_fetched ?? 0}</strong> calls ·{" "}
            <strong>{result.calls_live_campaigns ?? 0}</strong> on live campaigns ·{" "}
            <strong>{result.calls_synced ?? 0}</strong> written ·{" "}
            <strong>{result.calls_with_tags ?? 0}</strong> with creative tags
          </p>
          {result.campaigns_kept?.length ? (
            <p className="text-muted-foreground">Campaigns: {result.campaigns_kept.join(", ")}</p>
          ) : null}
          {result.warning ? <p className="text-amber-600">{result.warning}</p> : null}
        </div>
      )}

      {result?.error && (
        <p className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">{result.error}</p>
      )}
    </Card>
  );
}
