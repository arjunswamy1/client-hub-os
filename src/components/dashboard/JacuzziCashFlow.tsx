import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { JACUZZI_CLIENT_ID } from "@/hooks/useJacuzziData";
import {
  parseBillingRows, estimateUnbilledWeeks, rokuBills, rokuCheckpoints, isOverdue, JacuzziInvoice,
} from "@/lib/jacuzziCashFlow";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle } from "lucide-react";

const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const d = (iso: string) => format(parseISO(iso), "MMM d");

const STATUS: Record<JacuzziInvoice["status"], { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  paid: { label: "Paid", variant: "default" },
  pending: { label: "Awaiting payment", variant: "secondary" },
  not_invoiced: { label: "Not invoiced yet", variant: "outline" },
  estimated: { label: "Estimate (hub leads)", variant: "outline" },
};

export default function JacuzziCashFlow() {
  const today = format(new Date(), "yyyy-MM-dd");

  const sheet = useQuery({
    queryKey: ["jacuzzi-billing-sheet"],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("jacuzzi-billing-sheet");
      if (error) throw error;
      return data as { values: unknown[][]; read_at: string };
    },
  });
  const leads = useQuery({
    queryKey: ["jacuzzi-cash-leads"],
    queryFn: () => fetchAllRows<{ transaction_date: string; payout_rate: number | null }>((o, s) =>
      supabase.from("jacuzzi_leads").select("transaction_date, payout_rate")
        .eq("client_id", JACUZZI_CLIENT_ID).order("transaction_date").range(o, o + s - 1) as any),
  });
  const delivery = useQuery({
    queryKey: ["jacuzzi-cash-delivery"],
    queryFn: () => fetchAllRows<{ date: string; spend: number | null }>((o, s) =>
      supabase.from("jacuzzi_delivery").select("date, spend")
        .eq("client_id", JACUZZI_CLIENT_ID).order("date").range(o, o + s - 1) as any),
  });

  const model = useMemo(() => {
    if (!sheet.data || !leads.data || !delivery.data) return null;
    const billed = parseBillingRows(sheet.data.values, today);
    const invoices = [...billed, ...estimateUnbilledWeeks(leads.data, billed)].sort((a, b) => a.weekOf.localeCompare(b.weekOf));
    const bills = rokuBills(delivery.data, today);
    const checkpoints = rokuCheckpoints(invoices, bills);
    const sum = (xs: JacuzziInvoice[]) => xs.reduce((s, i) => s + i.amount, 0);
    const paid = sum(invoices.filter((i) => i.status === "paid"));
    const owed = sum(invoices.filter((i) => i.status !== "paid"));
    const overdue = invoices.filter((i) => isOverdue(i, today));
    const totalRoku = bills.reduce((s, b) => s + b.amount, 0);
    const next = checkpoints.find((c) => c.bill.dueDate >= today) ?? null;
    return { invoices, checkpoints, paid, owed, overdue, totalRoku, lifetime: paid + owed - totalRoku, next };
  }, [sheet.data, leads.data, delivery.data, today]);

  if (sheet.error) {
    return <Card className="p-4 text-sm text-destructive">Couldn't read the Billing tab of the Jacuzzi sheet: {String((sheet.error as Error).message)}</Card>;
  }
  if (!model) return <Skeleton className="h-96 rounded-xl" />;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Next Roku bill</p>
          {model.next ? (
            <>
              <p className="mt-1 text-2xl font-semibold">{money(model.next.bill.amount)}</p>
              <p className="text-xs text-muted-foreground">
                {format(parseISO(`${model.next.bill.month}-01`), "MMMM")} media{model.next.bill.partial ? " (month to date)" : ""} · due {d(model.next.bill.dueDate)}
              </p>
            </>
          ) : <p className="mt-1 text-sm text-muted-foreground">None due</p>}
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Cash position on that date</p>
          {model.next && (
            <>
              <p className={`mt-1 text-2xl font-semibold ${model.next.position < 0 ? "text-destructive" : "text-primary"}`}>{money(model.next.position)}</p>
              <p className="text-xs text-muted-foreground">All Jacuzzi money due by then − all Roku bills due by then</p>
            </>
          )}
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Jacuzzi still owes</p>
          <p className="mt-1 text-2xl font-semibold">{money(model.owed)}</p>
          <p className="text-xs text-muted-foreground">{money(model.paid)} paid so far · includes estimates</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Lifetime once all paid</p>
          <p className={`mt-1 text-2xl font-semibold ${model.lifetime < 0 ? "text-destructive" : "text-primary"}`}>{money(model.lifetime)}</p>
          <p className="text-xs text-muted-foreground">Billed + estimated − {money(model.totalRoku)} Roku media</p>
        </Card>
      </div>

      {model.overdue.length > 0 && (
        <Card className="flex items-start gap-2 border-destructive/40 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span>
            Past due from Jacuzzi: {model.overdue.map((i) => `${i.invoiceNo ? `#${i.invoiceNo}` : `week of ${d(i.weekOf)}`} ${money(i.amount)} (due ${d(i.dueDate)})`).join(" · ")}
          </span>
        </Card>
      )}

      <Card className="p-4">
        <p className="mb-1 text-sm font-medium">Each Roku bill vs Jacuzzi money in hand by its due date</p>
        <p className="mb-3 text-xs text-muted-foreground">Running totals since launch. A negative position means that Roku payment has to be covered from other cash until Jacuzzi pays.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="p-2 text-left">Roku bill</th><th className="p-2 text-right">Amount</th><th className="p-2 text-left">Due</th>
                <th className="p-2 text-right">Jacuzzi due by then</th><th className="p-2 text-right">…of which paid</th>
                <th className="p-2 text-right">Roku due by then</th><th className="p-2 text-right">Position</th>
                <th className="p-2 text-right">Arrives after</th>
              </tr>
            </thead>
            <tbody>
              {model.checkpoints.map((c) => (
                <tr key={c.bill.month} className="border-b last:border-0">
                  <td className="p-2">{format(parseISO(`${c.bill.month}-01`), "MMM yyyy")}{c.bill.partial && <span className="ml-1 text-xs text-muted-foreground">(to date)</span>}</td>
                  <td className="p-2 text-right">{money(c.bill.amount)}</td>
                  <td className="p-2">{d(c.bill.dueDate)}</td>
                  <td className="p-2 text-right">{money(c.jacuzziDueBy)}</td>
                  <td className="p-2 text-right text-muted-foreground">{money(c.jacuzziPaidBy)}</td>
                  <td className="p-2 text-right">{money(c.rokuDueBy)}</td>
                  <td className={`p-2 text-right font-medium ${c.position < 0 ? "text-destructive" : "text-primary"}`}>{money(c.position)}</td>
                  <td className="p-2 text-right text-muted-foreground">{money(c.arrivingLater)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-4">
        <p className="mb-3 text-sm font-medium">Jacuzzi invoices by broadcast week</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="p-2 text-left">Week of</th><th className="p-2 text-left">Invoice</th><th className="p-2 text-right">Leads</th>
                <th className="p-2 text-right">Amount</th><th className="p-2 text-left">Invoiced</th><th className="p-2 text-left">Due</th><th className="p-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {model.invoices.map((i) => (
                <tr key={i.weekOf} className="border-b last:border-0">
                  <td className="p-2">{d(i.weekOf)}</td>
                  <td className="p-2">{i.invoiceNo ? `#${i.invoiceNo}` : "—"}</td>
                  <td className="p-2 text-right">{i.leads ?? "—"}</td>
                  <td className="p-2 text-right">{money(i.amount)}</td>
                  <td className="p-2">{d(i.invoiceDate)}</td>
                  <td className={`p-2 ${isOverdue(i, today) ? "font-medium text-destructive" : ""}`}>{d(i.dueDate)}</td>
                  <td className="p-2"><Badge variant={STATUS[i.status].variant} className="text-xs">{STATUS[i.status].label}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Billed weeks, amounts and paid status come from the Billing tab of the client sheet (read {d(sheet.data!.read_at.slice(0, 10))}). Weeks not on it yet are estimated from hub leads: invoiced 11 days after the week starts, due 30 days later. Roku is billed on the last day of each month, due 30 days later; whether a Roku bill has been paid isn't recorded in the hub.
        </p>
      </Card>
    </div>
  );
}
