import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { CANNABALL_CLIENT_ID } from "@/hooks/useCannaballData";

type Period = {
  id: string;
  did: string;
  did_formatted: string | null;
  creative_name: string;
  platform: string;
  effective_from: string;
  effective_to: string | null;
  notes: string | null;
};

const platformLabel = (p: string) => (p === "universal_ads" ? "Universal Ads" : p === "roku" ? "Roku" : p);
const day = (d: string) => format(new Date(`${d}T00:00:00`), "MMM d, yyyy");

export default function CannaballDidTracker() {
  const { data: periods = [], isLoading } = useQuery({
    queryKey: ["cannaball-did-periods"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_did_periods" as any)
        .select("id, did, did_formatted, creative_name, platform, effective_from, effective_to, notes")
        .eq("client_id", CANNABALL_CLIENT_ID)
        .order("effective_from", { ascending: false })
        .order("did", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as Period[];
    },
  });

  const groups = periods.reduce<Record<string, Period[]>>((acc, p) => {
    (acc[p.effective_from] ||= []).push(p);
    return acc;
  }, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Tracking number history</CardTitle>
        <CardDescription>
          Each time the numbers were re-pointed to new ads, calls before and after are credited to the right creative.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : periods.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tracking-number history saved yet.</p>
        ) : (
          Object.entries(groups)
            .sort(([a], [b]) => (a < b ? 1 : -1))
            .map(([from, rows]) => (
              <div key={from} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-semibold">
                    {day(from)} — {rows[0].effective_to ? day(rows[0].effective_to) : "now"}
                  </h4>
                  <Badge variant="outline">{platformLabel(rows[0].platform)}</Badge>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr className="text-left">
                      <th className="px-3 py-1.5 font-medium">Number</th>
                      <th className="px-3 py-1.5 font-medium">Ad</th>
                      <th className="px-3 py-1.5 font-medium">Channel</th>
                      <th className="px-3 py-1.5 font-medium">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-t">
                        <td className="px-3 py-1.5 font-mono text-xs">{r.did_formatted || r.did}</td>
                        <td className="px-3 py-1.5 font-medium">{r.creative_name}</td>
                        <td className="px-3 py-1.5">{platformLabel(r.platform)}</td>
                        <td className="px-3 py-1.5 text-xs text-muted-foreground">{r.notes || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
        )}
      </CardContent>
    </Card>
  );
}
