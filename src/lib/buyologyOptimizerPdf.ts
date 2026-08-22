/**
 * PDF export for the BuyologyIQ AI optimization brief.
 * Renders the AI plan as a selectable, paginated document for the media buyer.
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const money = (n: number) =>
  (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money2 = (n: number) =>
  (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

const BLUE: [number, number, number] = [59, 130, 246];
const SLATE: [number, number, number] = [15, 23, 42];
const MUTED: [number, number, number] = [100, 116, 139];

export interface OptimizerPlan {
  summary?: string;
  diagnosis?: string[];
  benchmarks?: { cost_per_qualified_call?: number; qualified_rate?: number; note?: string };
  recommendations?: {
    priority?: number;
    type?: string;
    severity?: string;
    entity?: string;
    title?: string;
    action?: string;
    rationale?: string;
    projected_impact?: string;
    confidence?: string;
  }[];
  budget_shifts?: { from?: string; to?: string; amount_usd?: number; reason?: string }[];
  creative_tests?: { hypothesis?: string; how?: string; measure?: string }[];
  watchouts?: string[];
}

export interface BuyologyPdfInput {
  lineLabel: string;
  rangeLabel: string;
  generatedAt: string;
  totals: {
    spend: number;
    calls: number;
    qualified: number;
    converted: number;
    cpqc: number;
    cpl: number;
    qualifiedRate: number;
    attributionRate: number;
  };
  plan: OptimizerPlan;
}

export function buildBuyologyOptimizerPdf(i: BuyologyPdfInput) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;
  let y = M;

  const space = (need: number) => {
    if (y + need > H - 50) {
      doc.addPage();
      y = M;
    }
  };
  const heading = (text: string) => {
    space(40);
    doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...SLATE);
    doc.text(text, M, y);
    y += 16;
  };
  const body = (text: string, color = MUTED, size = 9) => {
    doc.setFont("helvetica", "normal").setFontSize(size).setTextColor(...color);
    const lines = doc.splitTextToSize(text, W - M * 2);
    space(lines.length * 12 + 8);
    doc.text(lines, M, y);
    y += lines.length * 12 + 8;
  };
  const bullets = (items: string[]) => {
    for (const it of items) {
      doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...MUTED);
      const lines = doc.splitTextToSize(`•  ${it}`, W - M * 2 - 8);
      space(lines.length * 12 + 4);
      doc.text(lines, M + 4, y);
      y += lines.length * 12 + 4;
    }
    y += 4;
  };
  const table = (head: string[], rows: (string | number)[][], widths?: Record<number, number>) => {
    space(80);
    autoTable(doc, {
      startY: y,
      head: [head],
      body: rows,
      margin: { left: M, right: M },
      styles: { font: "helvetica", fontSize: 8, cellPadding: 4, textColor: SLATE, lineColor: [226, 232, 240], lineWidth: 0.5, overflow: "linebreak" },
      headStyles: { fillColor: SLATE, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: widths
        ? Object.fromEntries(Object.entries(widths).map(([k, v]) => [k, { cellWidth: v }]))
        : undefined,
    });
    y = (doc as any).lastAutoTable.finalY + 18;
  };

  // ---- Header ----
  doc.setFillColor(...SLATE);
  doc.rect(0, 0, W, 74, "F");
  doc.setFont("helvetica", "bold").setFontSize(15).setTextColor(255, 255, 255);
  doc.text("BuyologyIQ — AI Optimization Brief", M, 32);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(203, 213, 225);
  doc.text(`${i.lineLabel}  ·  ${i.rangeLabel}  ·  generated ${i.generatedAt}`, M, 50);
  doc.setTextColor(...BLUE);
  doc.text("Prepared for Belu (media buyer) · Connect Paid Media", M, 64);
  y = 100;

  // ---- KPI strip ----
  const kpis: [string, string][] = [
    ["Meta spend", money(i.totals.spend)],
    ["Raw calls", i.totals.calls.toLocaleString()],
    ["Qualified calls (60s+)", `${i.totals.qualified.toLocaleString()} (${Math.round(i.totals.qualifiedRate * 100)}%)`],
    ["Cost / qualified call", i.totals.qualified ? money2(i.totals.cpqc) : "—"],
    ["Cost / raw call", i.totals.calls ? money2(i.totals.cpl) : "—"],
    ["Attribution coverage", `${Math.round(i.totals.attributionRate * 100)}%`],
  ];
  const colW = (W - M * 2) / 3;
  kpis.forEach(([label, value], idx) => {
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    const x = M + col * colW;
    const ky = y + row * 42;
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...MUTED);
    doc.text(label.toUpperCase(), x, ky);
    doc.setFont("helvetica", "bold").setFontSize(12).setTextColor(...SLATE);
    doc.text(value, x, ky + 15);
  });
  y += 42 * Math.ceil(kpis.length / 3) + 10;

  // ---- Summary ----
  if (i.plan.summary) {
    heading("Executive summary");
    body(i.plan.summary, SLATE, 9.5);
  }

  if (i.plan.diagnosis?.length) {
    heading("What the data says");
    bullets(i.plan.diagnosis);
  }

  if (i.plan.benchmarks && (i.plan.benchmarks.cost_per_qualified_call || i.plan.benchmarks.qualified_rate)) {
    heading("Benchmarks to hold");
    const b = i.plan.benchmarks;
    body(
      [
        b.cost_per_qualified_call ? `Target cost per qualified call: ${money2(b.cost_per_qualified_call)}` : "",
        b.qualified_rate ? `Target qualified rate: ${(Number(b.qualified_rate) * (Number(b.qualified_rate) <= 1 ? 100 : 1)).toFixed(0)}%` : "",
        b.note || "",
      ].filter(Boolean).join("  ·  ")
    );
  }

  // ---- Recommendations ----
  const recs = [...(i.plan.recommendations || [])].sort((a, b) => (a.priority || 99) - (b.priority || 99));
  if (recs.length) {
    heading("Prioritized action plan");
    table(
      ["#", "Action", "Where", "Do this", "Why", "Expected impact"],
      recs.map((r, idx) => [
        String(r.priority ?? idx + 1),
        `${r.title || "-"}\n[${r.type || "optimize"} · ${r.severity || "medium"}]`,
        r.entity || "—",
        r.action || "—",
        r.rationale || "—",
        `${r.projected_impact || "—"}${r.confidence ? `\n(confidence: ${r.confidence})` : ""}`,
      ]),
      { 0: 18, 1: 92, 2: 90, 3: 130, 4: 110 }
    );
  }

  if (i.plan.budget_shifts?.length) {
    heading("Budget reallocation");
    table(
      ["Move from", "Move to", "Amount", "Reason"],
      i.plan.budget_shifts.map((s) => [s.from || "—", s.to || "—", money(Number(s.amount_usd || 0)), s.reason || "—"]),
      { 0: 120, 1: 120, 2: 60 }
    );
  }

  if (i.plan.creative_tests?.length) {
    heading("Creative tests to queue");
    table(
      ["Hypothesis", "How to build it", "How we measure it"],
      i.plan.creative_tests.map((t) => [t.hypothesis || "—", t.how || "—", t.measure || "—"])
    );
  }

  if (i.plan.watchouts?.length) {
    heading("Watchouts & data caveats");
    bullets(i.plan.watchouts);
  }

  // ---- Footer ----
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...MUTED);
    doc.text(
      "Qualified call = 60s+ talk time · Premium = 120s+ · Creative spend is lifetime-to-date from the Meta sync",
      M,
      H - 24
    );
    doc.text(`${p} / ${pages}`, W - M, H - 24, { align: "right" });
  }

  const slug = i.lineLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  doc.save(`buyologyiq-optimization-${slug}-${new Date().toISOString().slice(0, 10)}.pdf`);
}
