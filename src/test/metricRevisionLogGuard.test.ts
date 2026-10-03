import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * metric_revision_log is append-only. Exactly one module may write it
 * (_shared/metric-revision-log.ts), and only with insert — never update, upsert
 * or delete. A database trigger refuses UPDATE/DELETE as well; this keeps the
 * intent visible in code review.
 */
const ROOT = "supabase/functions";
const WRITER = join(ROOT, "_shared/metric-revision-log.ts");
const GAP = String.raw`(?:(?!\.from\()[\s\S]){0,300}?`;
const TOUCH = new RegExp(String.raw`\.from\(\s*['"\`]metric_revision_log['"\`]\s*\)${GAP}\.(insert|upsert|update|delete)\s*\(`, "g");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("metric_revision_log is append-only", () => {
  const files = walk(ROOT);
  it("only the one writer module writes it", () => {
    const offenders = files.filter((f) => f !== WRITER && [...readFileSync(f, "utf8").matchAll(TOUCH)].length);
    expect(offenders).toEqual([]);
  });
  it("the writer only inserts", () => {
    const ops = [...readFileSync(WRITER, "utf8").matchAll(TOUCH)].map((m) => m[1]);
    expect(ops).toEqual(["insert"]);
  });
  it("no file updates or deletes it by any route", () => {
    const loose = /metric_revision_log[\s\S]{0,40}\.(update|delete|upsert)\(/;
    expect(files.filter((f) => loose.test(readFileSync(f, "utf8")))).toEqual([]);
  });
});
