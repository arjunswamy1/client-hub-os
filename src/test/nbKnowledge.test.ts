import { describe, it, expect } from "vitest";
import {
  validateProposed, proofPointIsConcrete, evidenceIsVerbatim, mapVertical, mapChannel,
  sourceKindFor, isDuplicate, assembleForProposal,
} from "../../supabase/functions/_shared/nb-knowledge";

const meeting = "AJ: Connected calls jumped from 15% to 57% after the SIPS/zip optimisations on Windows.\nHolly: Performance improved a lot overall, honestly.";

describe("nb extraction rules", () => {
  it("evidence must be verbatim", () => {
    expect(evidenceIsVerbatim("Connected calls jumped from 15% to 57%", meeting)).toBe(true);
    expect(evidenceIsVerbatim("Connect rate nearly quadrupled", meeting)).toBe(false);
  });
  it("a proof point needs a figure that is in its evidence", () => {
    expect(proofPointIsConcrete({ kind: "proof_point", headline: "x", evidence: "Performance improved a lot overall", numbers: null }).ok).toBe(false);
    expect(proofPointIsConcrete({ kind: "proof_point", headline: "x", evidence: "Connected calls jumped from 15% to 57%", numbers: { after_pct: 57 } }).ok).toBe(true);
    expect(proofPointIsConcrete({ kind: "proof_point", headline: "x", evidence: "Connected calls jumped from 15% to 57%", numbers: { after_pct: 380 } }).ok).toBe(false);
  });
  it("rejects a vague proof point end to end", () => {
    const v = validateProposed({ kind: "proof_point", headline: "Performance improved overall for the client", evidence: "Performance improved a lot overall", numbers: {} }, meeting);
    expect(v.ok).toBe(false);
  });
  it("maps to the controlled lists or null", () => {
    expect(mapVertical("Final Expense")).toBe("final expense");
    expect(mapVertical("crypto")).toBeNull();
    expect(mapChannel("Roku")).toBe("ctv");
  });
  it("source kind comes from the meeting, never guessed", () => {
    expect(sourceKindFor({ client_id: "c", metadata: {} })).toBe("client");
    expect(sourceKindFor({ client_id: null, metadata: { agency_kind: "prospect" } })).toBe("prospect");
    expect(sourceKindFor({ client_id: null, metadata: {} })).toBeNull();
  });
  it("dedupes against a seeded row", () => {
    const seeded = [{ kind: "proof_point", headline: "Zip/SIPS optimisation lifted connected calls from 15% to 57% on a Windows campaign", evidence: "Connected calls jumped from 15% to 57% after the SIPS/zip optimisations on Windows." }];
    expect(isDuplicate({ kind: "proof_point", headline: "Windows connect rate rose from 15% to 57% after zip optimisation", evidence: "Connected calls jumped from 15% to 57%" }, seeded)).toBe(true);
  });
  it("copy-for-proposal excludes internal-only and names how many", () => {
    const base = { detail: null, evidence: null, vertical: "final expense", channel: "ctv", org_name: "PPC Media" };
    const out = assembleForProposal([
      { ...base, kind: "proof_point", headline: "A", confidentiality: "anonymised" },
      { ...base, kind: "pricing", headline: "B", confidentiality: "internal_only" },
      { ...base, kind: "pricing", headline: "C", confidentiality: "internal_only" },
    ]);
    expect(out.included).toBe(1);
    expect(out.withheld).toBe(2);
    expect(out.text).not.toMatch(/\bB\b|\bC\b|PPC Media/);
    expect(out.text).toMatch(/2 selected entries were withheld/);
  });
});
