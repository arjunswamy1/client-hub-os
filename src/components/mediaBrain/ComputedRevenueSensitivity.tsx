/**
 * INTAKE — the sensitivity swing shown at the moment the operator is asked for
 * the billable duration threshold.
 *
 * For any `computed` vertical the threshold is the revenue, so the operator
 * should see how far the answer moves before they type one. Read-only.
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/mediaBrain/shared";
import { SensitivityBandTable } from "@/components/mediaBrain/SensitivityBand";
import { useMediaBrainVerticalRead } from "@/hooks/useMediaBrainVerticalRead";

interface Props {
  clientId?: string;
  /** Window the swing is measured over. Stated explicitly, never inferred. */
  start: string;
  end: string;
}

export function ComputedRevenueSensitivity({ clientId, start, end }: Props) {
  const q = useMediaBrainVerticalRead(clientId, start, end);
  const payload = q.data;
  if (!payload || "error" in payload) return null;

  const rows = payload.read.rows.filter((r) => r.sensitivity && r.revenueSource === "computed");
  if (!rows.length) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">What the duration threshold decides</CardTitle>
        <CardDescription>
          {start} to {end}. These verticals compute revenue as payout × billable calls, so the threshold you are about
          to state is the revenue. Confirm it against the contract rather than assuming it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Notice tone="warn" title="This is the input the verdict turns on">
          Below is the same window read at each plausible threshold. Where the range crosses zero, the same 30 days are
          either clearly profitable or loss-making depending only on this one contract term.
        </Notice>
        {rows.map((r) => (
          <SensitivityBandTable
            key={r.vertical_id}
            label={r.label}
            spend={r.spend}
            calls={r.calls}
            band={r.sensitivity!}
            blockedFigures={r.blockedFigures}
          />
        ))}
      </CardContent>
    </Card>
  );
}
