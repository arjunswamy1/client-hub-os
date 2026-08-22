/**
 * PDF export for the RRM cost-per-raw-call optimization plan.
 *
 * Takes the already-computed analysis from RRMOptimizer and renders a clean,
 * shareable action document for the media buyer — no screenshotting, so the
 * tables stay selectable and paginate properly.
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money2 = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Brand palette (matches the hub's blue primary / slate text)
const BLUE: [number, number, number] = [59, 130, 246];
const SLATE: [number, number, number] = [15, 23, 42];
const MUTED: [number, number, number] = [100, 116, 139];
const RED: [number, number, number] = [220, 38, 38];

export type OptimizerPdfInput = {
  line: string;
  platformLabel: string;
  label: string; // "keyword" | "creative"
  rangeLabel: string;
  spend: number;
  rawCalls: number;
  clicksPerCall: number;
  currentCPRC: number;
  projectedCPRC: number;
  totalSavings: number;
  benchmark: { keyword: string; cprc: number } | null;
  drains: { keyword: string; matchType: string | null; spend: number; clicks: number; calls: number; cprc: number; recoverable: number }[];
  wasteTerms: { term: string; keyword: string | null; reason: string | null; spend: number; clicks: number }[];
  zeroCallTerms: { term: string; spend: number; clicks: number }[];
  byMatch: { matchType: string; spend: number; clicks: number; calls: number }[];
  ladder: { keyword: string; matchType: string | null; spend: number; clicks: number; calls: number }[];
  deadHours: { offHourRaw: number; hours: number[] };
  untagged: number;
  showMatch: boolean;
};

export function buildOptimizerPdf(i: OptimizerPdfInput) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth();
  const M = 40;
  let y = M;

  const heading = (text: string, gap = 18) => {
    if (y > doc.internal.pageSize.getHeight() - 120) {
      doc.addPage();
      y = M;
    }
    doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...SLATE);
    doc.text(text, M, y);
    y += gap;
  };
  const body = (text: string, color = MUTED) => {
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...color);
    const lines = doc.splitTextToSize(text, W - M * 2);
    if (y + lines.length * 12 > doc.internal.pageSize.getHeight() - 60) {
      doc.addPage();
      y = M;
    }
    doc.text(lines, M, y);
    y += lines.length * 12 + 6;
  };
  const table = (head: string[], rows: (string | number)[][], aligns?: ("left" | "right")[]) => {
    autoTable(doc, {
      startY: y,
      head: [head],
      body: rows,
      margin: { left: M, right: M },
      styles: { font: "helvetica", fontSize: 8, cellPadding: 4, textColor: SLATE, lineColor: [226, 232, 240], lineWidth: 0.5 },
      headStyles: { fillColor: SLATE, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: Object.fromEntries(
        (aligns || []).map((a, idx) => [idx, { halign: a }]),
      ) as any,
    });
    y = (doc as any).lastAutoTable.finalY + 18;
  };

  // ---- Cover header -------------------------------------------------------
  doc.setFillColor(...SLATE);
  doc.rect(0, 0, W, 86, "F");
  doc.setFont("helvetica", "bold").setFontSize(16).setTextColor(255, 255, 255);
  doc.text(`RRM — ${i.line} optimization plan`, M, 40);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(203, 213, 225);
  doc.text(`${i.platformLabel} · ${i.rangeLabel} · Connect Paid Media`, M, 60);
  y = 116;

  // ---- Headline numbers ---------------------------------------------------
  const cards: [string, string, string][] = [
    ["Media spend", money(i.spend), `${i.rawCalls} raw calls`],
    ["Cost / raw call", i.currentCPRC ? money2(i.currentCPRC) : "—", `${i.clicksPerCall ? i.clicksPerCall.toFixed(1) : "—"} clicks per call`],
    ["If actions applied", i.projectedCPRC ? money2(i.projectedCPRC) : "—", `${money(i.totalSavings)} redeployed`],
  ];
  const cw = (W - M * 2 - 16) / 3;
  cards.forEach(([t, v, s], idx) => {
    const x = M + idx * (cw + 8);
    doc.setDrawColor(226, 232, 240).setFillColor(248, 250, 252);
    doc.roundedRect(x, y, cw, 62, 4, 4, "FD");
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...MUTED);
    doc.text(t.toUpperCase(), x + 10, y + 16);
    doc.setFont("helvetica", "bold").setFontSize(15).setTextColor(...(idx === 2 ? BLUE : SLATE));
    doc.text(v, x + 10, y + 38);
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...MUTED);
    doc.text(s, x + 10, y + 52);
  });
  y += 82;

  body(
    `Only raw-call efficiency is scored in this plan — connect and conversion rates sit with routing and the buyer. ` +
      `Calls are attributed through the UTM Moja stamps on each call (${i.showMatch ? "utm_term = keyword" : "utm_content = creative"}).`,
  );

  // ---- Action 1: cut / cap -----------------------------------------------
  if (i.drains.length) {
    const rec = i.drains.reduce((s, d) => s + d.recoverable, 0);
    heading(`Action 1 — Cut or cap ${i.drains.length} ${i.label}${i.drains.length === 1 ? "" : "s"} (${money(rec)} recoverable)`);
    body(
      `Each row below takes a meaningful slice of ${i.line} spend at more than 2x the line's ${money2(i.currentCPRC)} cost per raw call` +
        (i.benchmark ? `, while "${i.benchmark.keyword}" delivers calls at ${money2(i.benchmark.cprc)}` : "") +
        `. Pause the zero-call rows outright; for the rest, cut bids or budget until they clear ${money2(i.currentCPRC)}.`,
    );
    table(
      [i.label.replace(/^./, (c) => c.toUpperCase()), ...(i.showMatch ? ["Match"] : []), "Spend", "Clicks", "Calls", "Cost / raw call", "Recoverable", "Action"],
      i.drains.map((d) => [
        d.keyword,
        ...(i.showMatch ? [d.matchType || "—"] : []),
        money2(d.spend),
        d.clicks.toLocaleString(),
        String(d.calls),
        d.calls > 0 ? money2(d.cprc) : "no calls",
        money2(d.recoverable),
        d.calls === 0 ? "Pause" : "Cut bid / cap budget",
      ]),
      i.showMatch
        ? ["left", "left", "right", "right", "right", "right", "right", "left"]
        : ["left", "right", "right", "right", "right", "right", "left"],
    );
    if (i.benchmark && i.benchmark.cprc > 0) {
      body(
        `Reallocating that spend at "${i.benchmark.keyword}"'s ${money2(i.benchmark.cprc)} rate would add roughly ` +
          `${Math.floor(rec / i.benchmark.cprc)} extra raw calls for the same budget.`,
      );
    }
  }

  // ---- Action 2: negatives ----------------------------------------------
  if (i.wasteTerms.length) {
    const waste = i.wasteTerms.reduce((s, t) => s + t.spend, 0);
    heading(`Action 2 — Add ${i.wasteTerms.length} negative keywords (${money(waste)} on non-caller intent)`);
    body(
      "These search terms spent money, produced zero calls, and read as DIY, price-shopping, job-seeking or non-emergency intent. Add them (or their root tokens) as campaign-level negatives.",
    );
    table(
      ["Search term", "Triggered by", "Why", "Spend", "Clicks"],
      i.wasteTerms.slice(0, 40).map((t) => [t.term, t.keyword || "—", t.reason || "—", money2(t.spend), String(t.clicks)]),
      ["left", "left", "left", "right", "right"],
    );
  }

  // ---- Action 3: high-click, no-call terms ------------------------------
  if (i.zeroCallTerms.length) {
    heading(`Action 3 — Fix ${i.zeroCallTerms.length} high-click search terms with no calls (${money(i.zeroCallTerms.reduce((s, t) => s + t.spend, 0))} at risk)`);
    body(
      "Real service intent but the click never turns into a call — usually a landing-page or click-to-call issue rather than a query issue. Confirm the tracking number renders above the fold on mobile for these queries before cutting them.",
    );
    table(
      ["Search term", "Spend", "Clicks"],
      i.zeroCallTerms.slice(0, 25).map((t) => [t.term, money2(t.spend), String(t.clicks)]),
      ["left", "right", "right"],
    );
  }

  // ---- Match-type efficiency -------------------------------------------
  if (i.byMatch.length > 1) {
    heading("Match-type efficiency");
    table(
      ["Match type", "Spend", "Clicks", "Calls", "Cost / raw call"],
      i.byMatch.map((m) => [
        m.matchType,
        money2(m.spend),
        m.clicks.toLocaleString(),
        m.calls >= 0.05 ? m.calls.toFixed(1) : "—",
        m.calls >= 0.05 ? money2(m.spend / m.calls) : "no calls",
      ]),
      ["left", "right", "right", "right", "right"],
    );
    body(
      "Shift budget toward the match type producing calls cheaper, and tighten the other with negatives instead of letting broad/phrase variants absorb the difference. Calls are split across match types by share of spend, since Moja records keyword text only.",
    );
  }

  // ---- Operational notes ------------------------------------------------
  const notes: string[] = [];
  if (i.deadHours.offHourRaw > 0) {
    notes.push(
      `${i.deadHours.offHourRaw} raw calls arrive in hours with a 0% connect rate (UTC hours ${i.deadHours.hours.join(", ")}). ` +
        "Add an ad schedule so budget stops flowing then, or get overflow routing in place before turning spend back on.",
    );
  }
  if (i.untagged > 0) {
    notes.push(
      `${i.untagged} of ${i.rawCalls} calls carry no UTM, so they cannot be scored to a ${i.label} — the tables above cover the tagged portion only. ` +
        `Verify the tracking template (${i.showMatch ? "utm_term={keyword}" : "utm_content={{ad.name}}"}) is on every ${i.showMatch ? "campaign" : "ad"}.`,
    );
  }
  if (notes.length) {
    heading("Operational notes");
    notes.forEach((n) => body(`• ${n}`, RED));
  }

  // ---- Full ladder ------------------------------------------------------
  if (i.ladder.length) {
    doc.addPage();
    y = M;
    heading(`${i.label.replace(/^./, (c) => c.toUpperCase())} efficiency ladder`);
    body(`Every ${i.label} with spend in this range, ranked by cost per raw call. Calls are exact UTM matches only.`);
    table(
      [i.label.replace(/^./, (c) => c.toUpperCase()), ...(i.showMatch ? ["Match"] : []), "Spend", "Clicks", "Calls", "Cost / raw call", "vs line"],
      i.ladder.map((r) => {
        const cprc = r.calls ? r.spend / r.calls : null;
        const delta = cprc && i.currentCPRC ? cprc / i.currentCPRC - 1 : null;
        return [
          r.keyword,
          ...(i.showMatch ? [r.matchType || "—"] : []),
          money2(r.spend),
          r.clicks.toLocaleString(),
          r.calls ? String(r.calls) : "—",
          cprc ? money2(cprc) : "no calls",
          delta == null ? "—" : `${delta > 0 ? "+" : ""}${(delta * 100).toFixed(0)}%`,
        ];
      }),
      i.showMatch
        ? ["left", "left", "right", "right", "right", "right", "right"]
        : ["left", "right", "right", "right", "right", "right"],
    );
  }

  // ---- Footers ----------------------------------------------------------
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...MUTED);
    doc.text(
      `RRM ${i.line} · ${i.rangeLabel} · generated ${new Date().toLocaleString("en-US")}`,
      M,
      doc.internal.pageSize.getHeight() - 24,
    );
    doc.text(`${p} / ${pages}`, W - M, doc.internal.pageSize.getHeight() - 24, { align: "right" });
  }

  return doc;
}
