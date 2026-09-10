import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Upload, PhoneIncoming, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { CANNABALL_CLIENT_ID } from "@/hooks/useCannaballData";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";

const WEBHOOK_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/callgrid-webhook`;

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
    } else if (ch === "," && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

const normDigits = (v: string) => String(v || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");

function toSeconds(v: string): number {
  if (!v) return 0;
  if (v.includes(":")) {
    const parts = v.split(":").map((p) => Number(p) || 0);
    return parts.reduce((acc, p) => acc * 60 + p, 0);
  }
  const n = Number(v);
  return isFinite(n) ? Math.round(n) : 0;
}

export default function CannaballCallGridSetup() {
  const [uploading, setUploading] = useState(false);
  const [syncing, setSyncing] = useState<number | null>(null);


  const { data: status, refetch } = useQuery({
    queryKey: ["cannaball-callgrid-status"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cannaball_calls" as any)
        .select("call_start")
        .eq("client_id", CANNABALL_CLIENT_ID)
        .order("call_start", { ascending: false })
        .limit(1);
      if (error) throw error;
      const { count } = await supabase
        .from("cannaball_calls" as any)
        .select("id", { count: "exact", head: true })
        .eq("client_id", CANNABALL_CLIENT_ID);
      return {
        lastCall: (data?.[0] as any)?.call_start as string | undefined,
        total: count || 0,
      };
    },
  });

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  const handleCsv = async (file: File) => {
    setUploading(true);
    try {
      const text = await file.text();
      const lines = text.trim().split(/\r?\n/);
      const headers = splitCsvLine(lines.shift()!).map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
      const find = (...names: string[]) => {
        for (const n of names) {
          const i = headers.indexOf(n.replace(/[^a-z0-9]/g, ""));
          if (i >= 0) return i;
        }
        return -1;
      };
      const iId = find("callid", "id", "uuid", "callsid");
      const iStart = find("callstart", "starttime", "datetime", "date", "createdat", "timestamp");
      const iCaller = find("caller", "callernumber", "from", "fromnumber", "ani");
      const iDid = find("did", "trackingnumber", "to", "tonumber", "dnis");
      const iDur = find("duration", "callduration", "totalduration");
      const iTalk = find("talktime", "connectionduration", "billableduration");
      const iState = find("callerstate", "state");
      const iCity = find("callercity", "city");
      const iPayout = find("payout", "revenue", "amount", "price");
      const iDisp = find("disposition", "status", "result");
      const iCampaign = find("campaign", "campaignname");
      const iCreative = find("creative", "creativename", "adname");

      if (iStart < 0) throw new Error("CSV needs a call date/time column");

      const dids = (await supabase
        .from("client_dids" as any)
        .select("did, did_formatted, creative_name, campaign_name")
        .eq("client_id", CANNABALL_CLIENT_ID)).data as any[] | null;

      const rows = lines.map((line, n) => {
        const c = splitCsvLine(line);
        const start = new Date(c[iStart]);
        if (isNaN(start.getTime())) return null;
        const didDigits = iDid >= 0 ? normDigits(c[iDid]) : "";
        const match = (dids || []).find(
          (d) => normDigits(d.did) === didDigits || normDigits(d.did_formatted) === didDigits,
        );
        const talk = iTalk >= 0 ? toSeconds(c[iTalk]) : 0;
        const dur = iDur >= 0 ? toSeconds(c[iDur]) : talk;
        return {
          client_id: CANNABALL_CLIENT_ID,
          call_id: (iId >= 0 && c[iId]) || `csv-${didDigits || "na"}-${start.getTime()}-${n}`,
          caller_number: iCaller >= 0 ? c[iCaller] || null : null,
          did: didDigits || (iDid >= 0 ? c[iDid] : null) || null,
          caller_state: iState >= 0 ? c[iState] || null : null,
          caller_city: iCity >= 0 ? c[iCity] || null : null,
          call_start: start.toISOString(),
          duration_seconds: dur,
          connection_duration_seconds: talk,
          connected: talk > 0 || dur > 0,
          payout: iPayout >= 0 ? Number(String(c[iPayout]).replace(/[^0-9.-]/g, "")) || 0 : 0,
          disposition: iDisp >= 0 ? c[iDisp] || null : null,
          campaign_name: (iCampaign >= 0 ? c[iCampaign] : null) || match?.campaign_name || null,
          creative_name: (iCreative >= 0 ? c[iCreative] : null) || match?.creative_name || null,
        };
      }).filter(Boolean) as any[];

      if (!rows.length) throw new Error("No valid call rows found");

      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase
          .from("cannaball_calls" as any)
          .upsert(rows.slice(i, i + 500) as any, { onConflict: "client_id,call_id" });
        if (error) throw error;
      }
      toast.success(`Imported ${rows.length} CallGrid calls`);
      await refetch();
    } catch (e: any) {
      toast.error(e.message || "Import failed");
    } finally {
      setUploading(false);
    }
  };

  const receiving = !!status?.lastCall;

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium flex items-center gap-2">
              <PhoneIncoming className="h-4 w-4 text-indigo-500" />
              CallGrid call feed
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Give this link to CallGrid so every Roku call lands in this dashboard automatically.
            </p>
          </div>
          <Badge variant={receiving ? "default" : "secondary"} className="gap-1">
            {receiving ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
            {receiving ? "Receiving calls" : "Waiting for first call"}
          </Badge>
        </div>

        <div className="rounded-md border bg-muted/30 p-3 space-y-2">
          <p className="text-xs font-medium">Webhook link (POST, JSON or form data)</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-background px-2 py-1.5 text-xs">
              {WEBHOOK_URL}?secret=YOUR_TOKEN
            </code>
            <Button size="sm" variant="outline" onClick={() => copy(`${WEBHOOK_URL}?secret=YOUR_TOKEN`, "Link")}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Replace <span className="font-mono">YOUR_TOKEN</span> with the access token from your setup notes.
            CallGrid can send it in the link or as the header <span className="font-mono">x-callgrid-secret</span>.
          </p>
        </div>

        <div className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-2">
          <div>
            <p className="font-medium text-foreground">Calls stored</p>
            <p>{(status?.total || 0).toLocaleString()}</p>
          </div>
          <div>
            <p className="font-medium text-foreground">Most recent call</p>
            <p>{status?.lastCall ? format(new Date(status.lastCall), "MMM d, yyyy HH:mm") : "None yet"}</p>
          </div>
        </div>

        <div className="rounded-md border p-3">
          <p className="text-xs font-medium">Fields we read from CallGrid</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Caller number, tracking number, city/state, start time, duration, talk time, payout, disposition,
            campaign, creative and the recording link. Tracking numbers are matched to the creative assignments
            in the DID grid, so creative reporting fills in even when CallGrid doesn't send a creative name.
          </p>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div>
          <h3 className="text-sm font-medium flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-emerald-500" />
            Direct CallGrid sync
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Calls are pulled straight from CallGrid every 15 minutes using the saved API key. Use the buttons
            below to refresh right now or reload a longer history. Repeat runs never create duplicates.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!!syncing} className="gap-1.5" onClick={() => runSync(2)}>
            <RefreshCw className={`h-3.5 w-3.5 ${syncing === 2 ? "animate-spin" : ""}`} />
            {syncing === 2 ? "Syncing…" : "Sync recent calls"}
          </Button>
          <Button size="sm" variant="outline" disabled={!!syncing} className="gap-1.5" onClick={() => runSync(45)}>
            <RefreshCw className={`h-3.5 w-3.5 ${syncing === 45 ? "animate-spin" : ""}`} />
            {syncing === 45 ? "Syncing…" : "Reload last 45 days"}
          </Button>
        </div>
      </Card>


      <Card className="p-4 space-y-3">
        <div>
          <h3 className="text-sm font-medium">Backfill past calls</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Export the full call history from CallGrid as CSV and upload it here. Repeat uploads won't create
            duplicates.
          </p>
        </div>
        <label>
          <input
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleCsv(e.target.files[0])}
          />
          <Button asChild size="sm" variant="outline" disabled={uploading} className="gap-1.5">
            <span className="cursor-pointer">
              <Upload className="h-3.5 w-3.5" />
              {uploading ? "Importing…" : "Upload CallGrid CSV"}
            </span>
          </Button>
        </label>
      </Card>
    </div>
  );
}
