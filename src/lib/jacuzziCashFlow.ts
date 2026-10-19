/**
 * JACUZZI CASH FLOW — when money actually arrives vs when Roku must be paid.
 *
 * Profit on the dashboard counts a lead on its call date. Cash does not move then:
 *  - Jacuzzi (Cannella) invoices each broadcast week (Mon–Sun) about 11 days after
 *    the week starts, Net 30. The client "Billing" tab is the source of truth for
 *    billed weeks, amounts (revised after recon) and paid status.
 *  - Roku bills each calendar month on its last day, Net 30.
 * Weeks not yet on the Billing tab are ESTIMATED from hub leads and labelled so.
 * Roku paid status is not recorded in the hub, so it is never assumed.
 */

export const JACUZZI_INVOICE_LAG_DAYS = 11;
export const NET_TERMS_DAYS = 30;

export type InvoiceStatus = "paid" | "pending" | "not_invoiced" | "estimated";

export interface JacuzziInvoice {
  weekOf: string; // YYYY-MM-DD (Monday)
  invoiceNo: string | null;
  leads: number | null;
  amount: number;
  invoiceDate: string;
  dueDate: string;
  status: InvoiceStatus;
  source: "sheet" | "hub_estimate";
}

export interface RokuBill {
  month: string; // YYYY-MM
  amount: number;
  invoiceDate: string;
  dueDate: string;
  partial: boolean;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}
export function weekStart(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return iso(d);
}
export const jacuzziInvoiceDate = (weekOf: string) => addDays(weekOf, JACUZZI_INVOICE_LAG_DAYS);
export const jacuzziDueDate = (weekOf: string) => addDays(jacuzziInvoiceDate(weekOf), NET_TERMS_DAYS);

export function rokuBillDates(month: string) {
  const [y, m] = month.split("-").map(Number);
  const last = iso(new Date(Date.UTC(y, m, 0)));
  return { invoiceDate: last, dueDate: addDays(last, NET_TERMS_DAYS) };
}

const money = (v: unknown): number | null => {
  const s = String(v ?? "").replace(/[$,\s]/g, "");
  if (!s || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** "9/28" → ISO date, choosing the year that keeps it within ~6 months of today. */
export function sheetDate(v: unknown, today: string): string | null {
  const m = String(v ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!m) return null;
  const pad = (n: string) => n.padStart(2, "0");
  if (m[3]) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${pad(m[1])}-${pad(m[2])}`;
  const y = Number(today.slice(0, 4));
  const cand = `${y}-${pad(m[1])}-${pad(m[2])}`;
  return cand > addDays(today, 183) ? `${y - 1}-${pad(m[1])}-${pad(m[2])}` : cand;
}

/**
 * Rows of the client "Billing" tab, read from column A. Columns: B month, C inv#,
 * D week of, E billed leads, F CM total due, H invoice date, I due date, J status,
 * L current billable leads, N revised CM due. Total rows and empty weeks are skipped.
 */
export function parseBillingRows(values: unknown[][], today: string): JacuzziInvoice[] {
  const out: JacuzziInvoice[] = [];
  for (const r of values) {
    const weekOf = sheetDate(r[3], today);
    if (!weekOf) continue;
    const revised = money(r[13]);
    const original = money(r[5]);
    const amount = revised ?? original ?? 0;
    if (amount <= 0) continue; // week not billed yet — estimated from hub leads instead
    const statusText = String(r[9] ?? "").toUpperCase();
    const status: InvoiceStatus = statusText.includes("PAID") && !statusText.includes("PENDING")
      ? "paid"
      : statusText.includes("PENDING INV") || !String(r[2] ?? "").trim()
        ? "not_invoiced"
        : "pending";
    const leads = Number(r[11] ?? r[4]);
    out.push({
      weekOf,
      invoiceNo: String(r[2] ?? "").trim() || null,
      leads: Number.isFinite(leads) && String(r[11] ?? r[4] ?? "").trim() !== "" ? leads : null,
      amount,
      invoiceDate: sheetDate(r[7], today) ?? jacuzziInvoiceDate(weekOf),
      dueDate: sheetDate(r[8], today) ?? jacuzziDueDate(weekOf),
      status,
      source: "sheet",
    });
  }
  return out;
}

/** Hub-lead estimates for every week that the Billing tab has not billed yet. */
export function estimateUnbilledWeeks(
  leads: { transaction_date: string; payout_rate: number | string | null }[],
  billed: JacuzziInvoice[],
): JacuzziInvoice[] {
  const have = new Set(billed.map((b) => b.weekOf));
  const byWeek = new Map<string, { n: number; amt: number }>();
  for (const l of leads) {
    const wk = weekStart(l.transaction_date);
    if (have.has(wk)) continue;
    const cur = byWeek.get(wk) ?? { n: 0, amt: 0 };
    cur.n += 1;
    cur.amt += Number(l.payout_rate || 0);
    byWeek.set(wk, cur);
  }
  // Only weeks after the last billed week: older gaps are recon removals, not unbilled cash.
  const lastBilled = billed.reduce((m, b) => (b.weekOf > m ? b.weekOf : m), "");
  return [...byWeek.entries()]
    .filter(([wk]) => wk > lastBilled)
    .map(([weekOf, v]) => ({
      weekOf, invoiceNo: null, leads: v.n, amount: v.amt,
      invoiceDate: jacuzziInvoiceDate(weekOf), dueDate: jacuzziDueDate(weekOf),
      status: "estimated" as const, source: "hub_estimate" as const,
    }));
}

export function rokuBills(delivery: { date: string; spend: number | string | null }[], today: string): RokuBill[] {
  const byMonth = new Map<string, number>();
  for (const d of delivery) byMonth.set(d.date.slice(0, 7), (byMonth.get(d.date.slice(0, 7)) ?? 0) + Number(d.spend || 0));
  return [...byMonth.entries()].sort().map(([month, amount]) => ({
    month, amount, ...rokuBillDates(month), partial: month >= today.slice(0, 7),
  }));
}

export interface RokuCheckpoint {
  bill: RokuBill;
  /** Jacuzzi money due on or before this Roku due date (all time). */
  jacuzziDueBy: number;
  jacuzziPaidBy: number;
  /** Roku money due on or before this date (all time). */
  rokuDueBy: number;
  /** jacuzziDueBy − rokuDueBy: negative = must be funded from elsewhere. */
  position: number;
  /** Jacuzzi money for leads already earned that lands after this Roku date. */
  arrivingLater: number;
}

export function rokuCheckpoints(invoices: JacuzziInvoice[], bills: RokuBill[]): RokuCheckpoint[] {
  return bills.map((bill) => {
    const dueBy = invoices.filter((i) => i.dueDate <= bill.dueDate);
    const jacuzziDueBy = dueBy.reduce((s, i) => s + i.amount, 0);
    const jacuzziPaidBy = dueBy.filter((i) => i.status === "paid").reduce((s, i) => s + i.amount, 0);
    const rokuDueBy = bills.filter((b) => b.dueDate <= bill.dueDate).reduce((s, b) => s + b.amount, 0);
    const arrivingLater = invoices
      .filter((i) => i.dueDate > bill.dueDate && i.weekOf <= bill.invoiceDate)
      .reduce((s, i) => s + i.amount, 0);
    return { bill, jacuzziDueBy, jacuzziPaidBy, rokuDueBy, position: jacuzziDueBy - rokuDueBy, arrivingLater };
  });
}

export const isOverdue = (i: JacuzziInvoice, today: string) =>
  (i.status === "pending" || i.status === "not_invoiced") && i.dueDate < today;
