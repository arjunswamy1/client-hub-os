import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BUYOLOGY_CLIENT_ID } from "@/hooks/useBuyologyData";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

/** Minimal RFC-4180 CSV parser (handles quoted fields, embedded commas / newlines). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    field += c;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  return rows;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Ringba column aliases -> canonical field */
const ALIASES: Record<string, string[]> = {
  call_date: ["calldate", "calldt", "datetime", "date", "callstarttime", "timecalled", "calltime"],
  call_id: ["inboundcallid", "callid", "id", "uniquecallid"],
  campaign_name: ["campaign", "campaignname"],
  target_name: ["target", "targetname", "buyer", "buyername"],
  caller_number: ["callerid", "callernumber", "caller", "fromnumber", "ani"],
  inbound_number: ["number", "numberdialed", "inboundphonenumber", "trackingnumber", "did", "tonumber"],
  duration_seconds: ["calllengthinseconds", "duration", "calllength", "totalduration", "durationseconds", "connectedcalllengthinseconds", "talktime"],
  connected: ["connected", "hasconnected", "isconnected"],
  converted: ["converted", "hasconverted", "isconverted", "payoutgenerated"],
  revenue: ["revenue", "conversionamount", "conversionrevenue"],
  payout: ["payout", "payoutamount", "cost", "totalcost"],
  publisher: ["publisher", "publishername"],
  state: ["state", "callerstate", "callerstateprovince"],
  disposition: ["endcallsource", "disposition", "hangupsource"],
};

function buildIndex(header: string[]) {
  const normalized = header.map(norm);
  const idx: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(ALIASES)) {
    for (const a of aliases) {
      const i = normalized.indexOf(a);
      if (i >= 0) { idx[field] = i; break; }
    }
  }
  return idx;
}

const truthy = (v: string) => {
  const s = (v || "").trim().toLowerCase();
  return s === "true" || s === "yes" || s === "1" || s === "y" || s === "connected" || s === "converted";
};

const money = (v: string) => Number((v || "").replace(/[$,]/g, "")) || 0;

/** "0:01:23" / "1:23" / "83" -> seconds */
function toSeconds(v: string): number {
  const s = (v || "").trim();
  if (!s) return 0;
  if (s.includes(":")) {
    const parts = s.split(":").map((p) => Number(p) || 0);
    return parts.reduce((acc, p) => acc * 60 + p, 0);
  }
  return Math.round(Number(s) || 0);
}

function toIso(v: string): string | null {
  const s = (v || "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString();
  return null;
}

// Only these campaigns are live for BuyologyIQ — everything else in a Ringba
// export (Health Sharing, Timeshare Exit, etc.) is filtered out on import.
const LIVE_CAMPAIGNS = ["walk in tubs", "bathroom remodel"];
const isLiveCampaign = (name: string) => {
  const n = name.trim().toLowerCase();
  return LIVE_CAMPAIGNS.some((c) => n === c || n.includes(c));
};

type Parsed = {
  rows: any[];
  skipped: number;
  offCampaign: number;
  missing: string[];
};

function mapRows(csv: string[][]): Parsed {
  if (csv.length < 2) throw new Error("CSV needs a header row and at least one call row");
  const idx = buildIndex(csv[0]);
  const missing = ["call_date"].filter((k) => idx[k] === undefined);
  if (missing.length) {
    throw new Error(
      `Could not find a call date column. Header found: ${csv[0].slice(0, 12).join(", ")}`
    );
  }

  const rows: any[] = [];
  let skipped = 0;
  let offCampaign = 0;
  const seen = new Set<string>();

  for (let i = 1; i < csv.length; i++) {
    const cells = csv[i];
    const get = (f: string) => (idx[f] !== undefined ? (cells[idx[f]] ?? "").trim() : "");
    const iso = toIso(get("call_date"));
    if (!iso) { skipped++; continue; }

    const campaign = get("campaign_name");
    if (campaign && !isLiveCampaign(campaign)) { offCampaign++; continue; }


    const duration = toSeconds(get("duration_seconds"));
    const connectedRaw = get("connected");
    const connected = connectedRaw ? truthy(connectedRaw) : duration > 0;
    const convertedRaw = get("converted");
    const revenue = money(get("revenue"));
    const converted = convertedRaw ? truthy(convertedRaw) : revenue > 0;

    const callId =
      get("call_id") ||
      `csv-${iso}-${get("caller_number") || "unknown"}-${get("inbound_number") || ""}`;
    if (seen.has(callId)) { skipped++; continue; }
    seen.add(callId);

    rows.push({
      client_id: BUYOLOGY_CLIENT_ID,
      call_id: callId,
      call_date: iso,
      campaign_name: campaign || null,
      target_name: get("target_name") || null,
      caller_number: get("caller_number") || null,
      inbound_number: get("inbound_number") || null,
      duration_seconds: duration,
      connected,
      converted: connected && converted,
      revenue: connected && converted ? revenue : 0,
      payout: money(get("payout")),
      metadata: {
        source: "ringba_csv",
        publisher: get("publisher") || null,
        state: get("state") || null,
        disposition: get("disposition") || null,
      },
    });
  }

  if (rows.length === 0)
    throw new Error(
      offCampaign > 0
        ? `No live-campaign calls found — ${offCampaign} rows were outside Walk In Tubs / Bathroom Remodel`
        : "No usable rows found — check the call date column format"
    );
  return { rows, skipped, offCampaign, missing: [] };

}

export default function BuyologyRingbaImport() {
  const qc = useQueryClient();
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [filename, setFilename] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleFile = async (file: File) => {
    setFilename(file.name);
    setError(null);
    setParsed(null);
    try {
      const text = await file.text();
      const result = mapRows(parseCsv(text));
      setParsed(result);
      toast.success(`Parsed ${result.rows.length} calls from ${file.name}`);
    } catch (e: any) {
      setError(e.message || "Failed to parse CSV");
    }
  };

  const save = async () => {
    if (!parsed) return;
    setSaving(true);
    try {
      const chunkSize = 500;
      let saved = 0;
      for (let i = 0; i < parsed.rows.length; i += chunkSize) {
        const chunk = parsed.rows.slice(i, i + chunkSize);
        const { error: err } = await supabase
          .from("ringba_calls")
          .upsert(chunk, { onConflict: "client_id,call_id" });
        if (err) throw err;
        saved += chunk.length;
      }
      toast.success(`Imported ${saved} calls`);
      setParsed(null);
      setFilename("");
      qc.invalidateQueries({ queryKey: ["buyology-calls"] });
    } catch (e: any) {
      toast.error(e.message || "Import failed");
    } finally {
      setSaving(false);
    }
  };

  const downloadTemplate = () => {
    const csv = [
      "Call Date,Inbound Call ID,Campaign,Target,Caller ID,Number Dialed,Duration,Connected,Converted,Revenue,Payout,Publisher,State,End Call Source",
      "2026-08-20 14:32:10,CA1234567890,BuyologyIQ - FE Meta,Buyer A,+13055551212,+18885551212,0:02:41,true,true,55.00,55.00,CPM,FL,buyer",
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ringba_calls_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const preview = parsed?.rows.slice(0, 8) || [];
  const totalRevenue = (parsed?.rows || []).reduce((s, r) => s + Number(r.revenue || 0), 0);

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold">Import Ringba call export</h3>
            <p className="text-xs text-muted-foreground">
              Export the call log from Ringba as CSV and drop it here. Columns are auto-detected and re-imports
              overwrite matching call IDs, so uploading overlapping ranges is safe.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={downloadTemplate}>
              <Download className="h-3.5 w-3.5" />
              Template
            </Button>
            <Button asChild size="sm" className="gap-1.5">
              <label>
                <Upload className="h-3.5 w-3.5" />
                Choose CSV
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                />
              </label>
            </Button>
          </div>
        </div>

        {error && (
          <p className="mt-3 rounded-md bg-destructive/10 p-3 text-xs text-destructive">{error}</p>
        )}

        {parsed && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{filename}</span>
              <span>{parsed.rows.length} calls</span>
              <span>{parsed.rows.filter((r) => r.connected).length} connected</span>
              <span>{parsed.rows.filter((r) => r.converted).length} converted</span>
              <span>${totalRevenue.toLocaleString()} revenue</span>
              {parsed.skipped > 0 && <span>{parsed.skipped} rows skipped</span>}
              {parsed.offCampaign > 0 && (
                <span>{parsed.offCampaign} non-live campaign rows excluded</span>
              )}

            </div>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Campaign</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Caller</TableHead>
                    <TableHead className="text-right">Dur</TableHead>
                    <TableHead className="text-right">Rev</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {new Date(r.call_date).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs">{r.campaign_name || "—"}</TableCell>
                      <TableCell className="text-xs">{r.target_name || "—"}</TableCell>
                      <TableCell className="text-xs">{r.caller_number || "—"}</TableCell>
                      <TableCell className="text-right text-xs">{r.duration_seconds}s</TableCell>
                      <TableCell className="text-right text-xs">${Number(r.revenue).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Import {parsed.rows.length} calls
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
