import { useMemo } from "react";
import { ClientDID, PLATFORM_LABELS, DIDPlatform } from "@/hooks/useClientDids";
import { cn } from "@/lib/utils";

const PLATFORMS: DIDPlatform[] = ["roku", "universal", "google_demand_gen"];

const statusColor: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-200",
  paused: "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950/40 dark:text-amber-200",
  not_in_use: "bg-muted text-muted-foreground border-border",
};

interface Props {
  dids: ClientDID[];
  onCellClick?: (did: ClientDID) => void;
}

/** Grid: rows = creatives, columns = platforms, cells = DIDs assigned. */
export function DIDMatrix({ dids, onCellClick }: Props) {
  const creatives = useMemo(() => {
    const set = new Set<string>();
    dids.forEach((d) => {
      if (d.creative_name) set.add(d.creative_name);
    });
    return Array.from(set).sort();
  }, [dids]);

  if (creatives.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No creatives assigned yet. Add DIDs and link them to creatives to see the matrix.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted/40">
          <tr>
            <th className="sticky left-0 z-10 bg-muted/40 px-3 py-2 text-left font-medium">Creative</th>
            {PLATFORMS.map((p) => (
              <th key={p} className="px-3 py-2 text-left font-medium">{PLATFORM_LABELS[p]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {creatives.map((creative) => (
            <tr key={creative} className="border-t">
              <td className="sticky left-0 z-10 bg-card px-3 py-2 font-medium">{creative}</td>
              {PLATFORMS.map((platform) => {
                const cellDids = dids.filter(
                  (d) => d.creative_name === creative && d.platform === platform
                );
                return (
                  <td key={platform} className="px-3 py-2 align-top">
                    {cellDids.length === 0 ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {cellDids.map((d) => (
                          <button
                            key={d.id}
                            onClick={() => onCellClick?.(d)}
                            className={cn(
                              "rounded-md border px-2 py-1 text-left text-xs font-mono transition hover:ring-2 hover:ring-primary/40",
                              statusColor[d.status]
                            )}
                            title={d.audience_cluster || ""}
                          >
                            <div>{d.did_formatted || d.did}</div>
                            {d.audience_cluster && (
                              <div className="font-sans text-[10px] opacity-70">{d.audience_cluster}</div>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
