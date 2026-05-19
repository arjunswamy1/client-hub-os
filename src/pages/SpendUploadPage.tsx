import { useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, Plus, Trash2, Download } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

const FOURJS_CLIENT_ID = "a9fce72e-87d5-4c45-9d94-03d78be7e42d";
const PLATFORMS = [
  { value: "roku", label: "Roku" },
  { value: "universal", label: "Universal" },
  { value: "google_demand_gen", label: "Google Demand Gen" },
];

type SpendRow = {
  date: string;
  platform: string;
  campaign_name: string | null;
  creative_name: string | null;
  audience_cluster: string | null;
  spend: number;
  impressions: number;
  completed_views?: number;
  clicks?: number;
};

const REQUIRED_COLS = ["date", "platform", "spend"];
const ALL_COLS = ["date","platform","campaign_name","creative_name","audience_cluster","spend","impressions","completed_views","clicks"];

function parseCSV(text: string): SpendRow[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error("CSV must have a header and at least one row");
  const header = lines[0].split(",").map((s) => s.trim().toLowerCase());
  for (const r of REQUIRED_COLS) {
    if (!header.includes(r)) throw new Error(`Missing required column: ${r}`);
  }
  const rows: SpendRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",").map((s) => s.trim());
    const get = (k: string) => {
      const idx = header.indexOf(k);
      return idx >= 0 ? cells[idx] : "";
    };
    const platform = get("platform").toLowerCase();
    if (!PLATFORMS.some((p) => p.value === platform)) {
      throw new Error(`Row ${i + 1}: invalid platform "${platform}". Must be roku, universal, or google_demand_gen`);
    }
    const date = get("date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error(`Row ${i + 1}: date must be YYYY-MM-DD, got "${date}"`);
    }
    rows.push({
      date,
      platform,
      campaign_name: get("campaign_name") || null,
      creative_name: get("creative_name") || null,
      audience_cluster: get("audience_cluster") || null,
      spend: Number(get("spend")) || 0,
      impressions: Number(get("impressions")) || 0,
      completed_views: Number(get("completed_views")) || 0,
      clicks: Number(get("clicks")) || 0,
    });
  }
  return rows;
}

export default function SpendUploadPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"upload" | "manual" | "history">("upload");

  // ---------- Manual entry ----------
  const today = format(new Date(), "yyyy-MM-dd");
  const [m, setM] = useState<SpendRow>({
    date: today, platform: "roku",
    campaign_name: "", creative_name: "", audience_cluster: "",
    spend: 0, impressions: 0, completed_views: 0, clicks: 0,
  });

  // ---------- CSV ----------
  const [csvRows, setCsvRows] = useState<SpendRow[] | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string>("");

  const handleFile = async (file: File) => {
    setFilename(file.name);
    setCsvError(null);
    try {
      const text = await file.text();
      const rows = parseCSV(text);
      setCsvRows(rows);
      toast.success(`Parsed ${rows.length} rows from ${file.name}`);
    } catch (e: any) {
      setCsvError(e.message);
      setCsvRows(null);
    }
  };

  const downloadTemplate = () => {
    const sample = [
      ALL_COLS.join(","),
      `${today},roku,FE-Spring-2026,Heaven_v3_60s,Boomer_Female_FE,250.00,12500,8200,180`,
      `${today},universal,FE-Q2,Family_v1_30s,Senior_Mixed,180.00,9000,5500,90`,
    ].join("\n");
    const blob = new Blob([sample], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "spend_template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  // ---------- Upsert ----------
  const upsert = useMutation({
    mutationFn: async (rows: SpendRow[]) => {
      const { data: userData } = await supabase.auth.getUser();
      const payload = rows.map((r) => ({
        client_id: FOURJS_CLIENT_ID,
        date: r.date,
        platform: r.platform,
        campaign_name: r.campaign_name || null,
        creative_name: r.creative_name || null,
        audience_cluster: r.audience_cluster || null,
        spend: r.spend,
        impressions: r.impressions,
        completed_views: r.completed_views ?? 0,
        clicks: r.clicks ?? 0,
        source: "manual_upload",
        uploaded_by_id: userData.user?.id ?? null,
      }));
      const { error } = await supabase
        .from("platform_spend_4js")
        .upsert(payload, {
          onConflict: "client_id,date,platform,campaign_name,creative_name,audience_cluster",
          ignoreDuplicates: false,
        });
      if (error) throw error;
      return payload.length;
    },
    onSuccess: (n) => {
      toast.success(`Saved ${n} spend ${n === 1 ? "row" : "rows"}`);
      qc.invalidateQueries({ queryKey: ["fourjs-spend"] });
      qc.invalidateQueries({ queryKey: ["spend-history"] });
      setCsvRows(null); setFilename("");
      setM({ ...m, spend: 0, impressions: 0, completed_views: 0, clicks: 0 });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to save"),
  });

  // ---------- History ----------
  const history = useQuery({
    queryKey: ["spend-history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_spend_4js")
        .select("id, date, platform, campaign_name, creative_name, audience_cluster, spend, impressions, source")
        .eq("client_id", FOURJS_CLIENT_ID)
        .order("date", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data || [];
    },
  });

  const deleteRow = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("platform_spend_4js").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["spend-history"] });
      qc.invalidateQueries({ queryKey: ["fourjs-spend"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Delete failed"),
  });

  const csvTotal = useMemo(
    () => (csvRows || []).reduce((s, r) => s + Number(r.spend || 0), 0),
    [csvRows]
  );

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Spend Upload — 4Js</h1>
        <p className="text-sm text-muted-foreground">
          Upload Roku, Universal, and Google Demand Gen spend manually. Live API sync coming later.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="upload">CSV Upload</TabsTrigger>
          <TabsTrigger value="manual">Manual Entry</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        {/* ---------- CSV ---------- */}
        <TabsContent value="upload" className="space-y-4">
          <Card className="p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-semibold">Bulk CSV Upload</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Required columns: <code>date, platform, spend</code>. Optional:{" "}
                  <code>campaign_name, creative_name, audience_cluster, impressions, completed_views, clicks</code>.
                  Date format YYYY-MM-DD. Platform: roku | universal | google_demand_gen.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={downloadTemplate}>
                <Download className="h-4 w-4 mr-2" /> Template
              </Button>
            </div>

            <label className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-8 cursor-pointer hover:bg-muted/50 transition">
              <Upload className="h-6 w-6 text-muted-foreground" />
              <span className="text-sm">{filename || "Drop or click to choose a CSV"}</span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
            </label>

            {csvError && (
              <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
                {csvError}
              </div>
            )}

            {csvRows && (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span>
                    <strong>{csvRows.length}</strong> rows · Total spend:{" "}
                    <strong>${csvTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>
                  </span>
                  <Button onClick={() => upsert.mutate(csvRows)} disabled={upsert.isPending}>
                    {upsert.isPending ? "Saving..." : `Upload ${csvRows.length} rows`}
                  </Button>
                </div>
                <div className="max-h-96 overflow-auto rounded border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Platform</TableHead>
                        <TableHead>Campaign</TableHead>
                        <TableHead>Creative</TableHead>
                        <TableHead>Cluster</TableHead>
                        <TableHead className="text-right">Spend</TableHead>
                        <TableHead className="text-right">Impr.</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {csvRows.slice(0, 100).map((r, i) => (
                        <TableRow key={i}>
                          <TableCell>{r.date}</TableCell>
                          <TableCell>{r.platform}</TableCell>
                          <TableCell>{r.campaign_name || "—"}</TableCell>
                          <TableCell>{r.creative_name || "—"}</TableCell>
                          <TableCell>{r.audience_cluster || "—"}</TableCell>
                          <TableCell className="text-right">${r.spend.toLocaleString()}</TableCell>
                          <TableCell className="text-right">{r.impressions.toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {csvRows.length > 100 && (
                    <p className="p-2 text-center text-xs text-muted-foreground">
                      Showing first 100 of {csvRows.length} rows
                    </p>
                  )}
                </div>
              </>
            )}
          </Card>
        </TabsContent>

        {/* ---------- Manual ---------- */}
        <TabsContent value="manual">
          <Card className="p-6 space-y-4 max-w-3xl">
            <h2 className="font-semibold">Add Single Spend Row</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Date</Label>
                <Input type="date" value={m.date} onChange={(e) => setM({ ...m, date: e.target.value })} />
              </div>
              <div>
                <Label>Platform</Label>
                <Select value={m.platform} onValueChange={(v) => setM({ ...m, platform: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PLATFORMS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Campaign Name</Label>
                <Input value={m.campaign_name || ""} onChange={(e) => setM({ ...m, campaign_name: e.target.value })} />
              </div>
              <div>
                <Label>Creative Name</Label>
                <Input value={m.creative_name || ""} onChange={(e) => setM({ ...m, creative_name: e.target.value })} />
              </div>
              <div>
                <Label>Audience Cluster</Label>
                <Input value={m.audience_cluster || ""} onChange={(e) => setM({ ...m, audience_cluster: e.target.value })} />
              </div>
              <div>
                <Label>Spend ($)</Label>
                <Input type="number" step="0.01" value={m.spend} onChange={(e) => setM({ ...m, spend: Number(e.target.value) })} />
              </div>
              <div>
                <Label>Impressions</Label>
                <Input type="number" value={m.impressions} onChange={(e) => setM({ ...m, impressions: Number(e.target.value) })} />
              </div>
              <div>
                <Label>Completed Views</Label>
                <Input type="number" value={m.completed_views || 0} onChange={(e) => setM({ ...m, completed_views: Number(e.target.value) })} />
              </div>
              <div>
                <Label>Clicks</Label>
                <Input type="number" value={m.clicks || 0} onChange={(e) => setM({ ...m, clicks: Number(e.target.value) })} />
              </div>
            </div>
            <Button
              onClick={() => upsert.mutate([m])}
              disabled={upsert.isPending || !m.date || m.spend < 0}
            >
              <Plus className="h-4 w-4 mr-2" /> {upsert.isPending ? "Saving..." : "Save Row"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Saving the same date + platform + campaign + creative + cluster will overwrite existing values.
            </p>
          </Card>
        </TabsContent>

        {/* ---------- History ---------- */}
        <TabsContent value="history">
          <Card className="p-0 overflow-hidden">
            <div className="max-h-[600px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Platform</TableHead>
                    <TableHead>Campaign</TableHead>
                    <TableHead>Creative</TableHead>
                    <TableHead>Cluster</TableHead>
                    <TableHead className="text-right">Spend</TableHead>
                    <TableHead className="text-right">Impr.</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(history.data || []).map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.date}</TableCell>
                      <TableCell>{r.platform}</TableCell>
                      <TableCell>{r.campaign_name || "—"}</TableCell>
                      <TableCell>{r.creative_name || "—"}</TableCell>
                      <TableCell>{r.audience_cluster || "—"}</TableCell>
                      <TableCell className="text-right">${Number(r.spend).toLocaleString()}</TableCell>
                      <TableCell className="text-right">{Number(r.impressions).toLocaleString()}</TableCell>
                      <TableCell><span className="text-xs text-muted-foreground">{r.source}</span></TableCell>
                      <TableCell>
                        <Button size="icon" variant="ghost" onClick={() => deleteRow.mutate(r.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(history.data || []).length === 0 && !history.isLoading && (
                    <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No spend uploaded yet</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
