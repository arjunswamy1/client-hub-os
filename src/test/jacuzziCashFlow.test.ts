import { describe, expect, it } from "vitest";
import {
  parseBillingRows, estimateUnbilledWeeks, rokuBills, rokuCheckpoints,
  jacuzziInvoiceDate, jacuzziDueDate, rokuBillDates,
} from "@/lib/jacuzziCashFlow";

const TODAY = "2026-10-19";

describe("Jacuzzi cash timing rules", () => {
  it("Jacuzzi invoices 11 days after week start, due Net 30", () => {
    expect(jacuzziInvoiceDate("2026-09-28")).toBe("2026-10-09");
    expect(jacuzziDueDate("2026-09-28")).toBe("2026-11-08");
  });

  it("Roku September bill is due 30 Oct", () => {
    expect(rokuBillDates("2026-09")).toEqual({ invoiceDate: "2026-09-30", dueDate: "2026-10-30" });
  });

  it("uses the revised amount, skips total rows and unbilled weeks", () => {
    const rows = [
      ["", "August", "1067", "8/10", "30", "$11,640.00", "$388.00", "8/21", "9/20", "PAID", "8/10", "26", "-4", "$10,088.00"],
      ["", "", "", "Aug Total", "100", "$38,800.00"],
      ["", "September", "1085", "9/7", "26", "$10,088.00", "$388.00", "9/18", "10/18", "PENDING PMT", "9/7", "26", "0", "$10,088.00"],
      ["", "October", "", "10/12", "", "$0.00", "$330.00", "10/23", "11/22"],
    ];
    const inv = parseBillingRows(rows, TODAY);
    expect(inv).toHaveLength(2);
    expect(inv[0]).toMatchObject({ weekOf: "2026-08-10", amount: 10088, status: "paid" });
    expect(inv[1]).toMatchObject({ weekOf: "2026-09-07", status: "pending", dueDate: "2026-10-18" });
  });

  it("estimates only weeks after the last billed week from hub leads", () => {
    const billed = parseBillingRows([["", "Oct", "", "10/5", "68", "$22,440.00", "", "10/16", "11/15", "PENDING INV"]], TODAY);
    const est = estimateUnbilledWeeks([
      { transaction_date: "2026-10-06", payout_rate: 330 },
      { transaction_date: "2026-10-13", payout_rate: 330 },
      { transaction_date: "2026-10-14", payout_rate: 330 },
    ], billed);
    expect(est).toEqual([expect.objectContaining({ weekOf: "2026-10-12", amount: 660, status: "estimated", dueDate: "2026-11-22" })]);
  });

  it("shows the shortfall at a Roku due date when Jacuzzi pays later", () => {
    const inv = parseBillingRows([
      ["", "Sep", "1091", "9/14", "96", "$37,248.00", "", "9/25", "10/25", "PENDING PMT", "", "96", "0", "$37,248.00"],
      ["", "Sep", "1094", "9/21", "63", "$24,444.00", "", "10/2", "11/1", "PENDING PMT", "", "63", "0", "$24,444.00"],
    ], TODAY);
    const [cp] = rokuCheckpoints(inv, rokuBills([{ date: "2026-09-15", spend: 57781.67 }], TODAY));
    expect(cp.jacuzziDueBy).toBe(37248);
    expect(Math.round(cp.position)).toBe(-20534);
    expect(cp.arrivingLater).toBe(24444);
  });
});
