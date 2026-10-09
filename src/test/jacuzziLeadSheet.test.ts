import { describe, it, expect } from "vitest";
import { parseLeadRows, rateFor, extendTotals, isoToSerial, serialToIso, stationRowValues, countCell } from "../../supabase/functions/_shared/jacuzzi-lead-sheet";

describe("Jacuzzi lead email → sheet helpers", () => {
  it("parses TM rows: Excel dates, QR detail, station", () => {
    const rows = parseLeadRows([
      { "Transaction ID": 6478732, "Transaction Date": isoToSerial("2026-10-08"), "Transaction Time": "17:19:58", "Record Detail": "QR", "Station Code": "CT20", "Billing Zip Code": 15946 },
      { "Transaction ID": 6478184, "Transaction Date": isoToSerial("2026-10-08"), "Transaction Time": 0.5, "Record Detail": null, "Station Code": "ct26" },
      { "Transaction ID": null, "Transaction Date": 46303 },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ transaction_id: "6478732", transaction_date: "2026-10-08", lead_type: "qr", station_code: "CT20", billing_zip: "15946" });
    expect(rows[1]).toMatchObject({ lead_type: "call", station_code: "CT26", transaction_time: "12:00:00" });
  });

  it("prices $388 before 30 Sep and $330 from 30 Sep", () => {
    const rates = [{ effective_from: "2026-06-30", rate: 388 }, { effective_from: "2026-09-30", rate: 330 }];
    expect(rateFor(rates, "2026-09-29")).toBe(388);
    expect(rateFor(rates, "2026-09-30")).toBe(330);
    expect(rateFor(rates, "2026-01-01")).toBeNull();
  });

  it("extends grand-total sums to the new last row only", () => {
    expect(extendTotals(["=SUM(D2:D71)", "=IFERROR((J72-F72)/J72,0)", "=SUM(G2:G710)"], 71, 73))
      .toEqual(["=SUM(D2:D73)", "=IFERROR((J72-F72)/J72,0)", "=SUM(G2:G710)"]);
  });

  it("date serials round-trip and new rows carry the rate", () => {
    expect(serialToIso(isoToSerial("2026-10-08"))).toBe("2026-10-08");
    expect(stationRowValues("CT26", 72, 330).at(-1)).toBe(330);
    expect(countCell(0)).toBe("-");
  });
});
