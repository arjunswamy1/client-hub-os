// A Supabase-query-builder stand-in backed by a REAL Postgres via psql, for
// tests that must exercise real triggers, constraints and SQL functions.
// Only the builder subset the mcp-hub creative tools use. Runs as the
// connection's role (superuser = the service role the hub uses).
import { execFileSync } from "node:child_process";

type Filter = [string, string, unknown];
const lit = (v: unknown): string => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number" || typeof v === "boolean") return `'${String(v)}'`;
  if (typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
};
const ident = (c: string) => `"${c.trim().replace(/"/g, "")}"`;

export function pgDb(connArgs: string) {
  const args = connArgs.split(/\s+/).filter(Boolean);
  const sql = (q: string): any => {
    const out = execFileSync("psql", [...args, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return JSON.parse(out.trim() || "null");
  };
  const run = (q: string) => { try { return { data: sql(q), error: null }; } catch (e: any) { return { data: null, error: { message: String(e.stderr || e.message) } }; } };

  const from = (table: string) => {
    const filters: Filter[] = [];
    let cols = "*"; let op: "select" | "insert" | "update" = "select"; let payload: any = null; let returning = false;
    let order: string | null = null; let lim: number | null = null; let off = 0; let single = false;
    const where = () => {
      const parts = filters.map(([o, c, v]) => {
        const col = ident(c);
        switch (o) {
          case "eq": return `${col} = ${lit(v)}`;
          case "neq": return `${col} <> ${lit(v)}`;
          case "is": return v === null ? `${col} IS NULL` : `${col} IS ${v ? "TRUE" : "FALSE"}`;
          case "gt": return `${col} > ${lit(v)}`;
          case "gte": return `${col} >= ${lit(v)}`;
          case "lt": return `${col} < ${lit(v)}`;
          case "lte": return `${col} <= ${lit(v)}`;
          case "in": return (v as unknown[]).length ? `${col} IN (${(v as unknown[]).map(lit).join(", ")})` : "FALSE";
          default: throw new Error(`pgDb: unsupported filter ${o}`);
        }
      });
      return parts.length ? ` WHERE ${parts.join(" AND ")}` : "";
    };
    const selList = () => cols.split(",").map((c) => c.trim()).filter(Boolean).map((c) => (c === "*" ? "*" : ident(c))).join(", ");
    const exec = () => {
      const t = `public.${ident(table)}`;
      const wrap = (inner: string) => single ? `SELECT row_to_json(x) FROM (${inner}) x LIMIT 1` : `SELECT coalesce(json_agg(x), '[]'::json) FROM (${inner}) x`;
      if (op === "select") {
        return run(wrap(`SELECT ${selList()} FROM ${t}${where()}${order ? ` ORDER BY ${order}` : ""}${lim !== null ? ` LIMIT ${lim}` : ""}${off ? ` OFFSET ${off}` : ""}`));
      }
      const rows = Array.isArray(payload) ? payload : [payload];
      const keys = [...new Set(rows.flatMap((r: any) => Object.keys(r)))].map(ident).join(", ");
      const json = lit(rows);
      if (op === "insert") {
        const q = `WITH w AS (INSERT INTO ${t} (${keys}) SELECT ${keys} FROM json_populate_recordset(NULL::${t}, ${json}) RETURNING *) ${returning ? wrap(`SELECT ${selList()} FROM w`) : "SELECT json_build_object('n', count(*)) FROM w"}`;
        const r = run(q); return returning ? r : { data: null, error: r.error };
      }
      const q = `WITH w AS (UPDATE ${t} SET (${keys}) = (SELECT ${keys} FROM json_populate_record(NULL::${t}, ${lit(rows[0])}))${where()} RETURNING *) ${returning ? wrap(`SELECT ${selList()} FROM w`) : "SELECT json_build_object('n', count(*)) FROM w"}`;
      const r = run(q); return returning ? r : { data: null, error: r.error };
    };
    const b: any = {
      select: (c = "*") => { cols = c; if (op !== "select") returning = true; return b; },
      insert: (rows: any) => { op = "insert"; payload = rows; return b; },
      update: (row: any) => { op = "update"; payload = row; return b; },
      eq: (c: string, v: unknown) => (filters.push(["eq", c, v]), b),
      neq: (c: string, v: unknown) => (filters.push(["neq", c, v]), b),
      is: (c: string, v: unknown) => (filters.push(["is", c, v]), b),
      gt: (c: string, v: unknown) => (filters.push(["gt", c, v]), b),
      gte: (c: string, v: unknown) => (filters.push(["gte", c, v]), b),
      lt: (c: string, v: unknown) => (filters.push(["lt", c, v]), b),
      lte: (c: string, v: unknown) => (filters.push(["lte", c, v]), b),
      in: (c: string, v: unknown[]) => (filters.push(["in", c, v]), b),
      order: (c: string, o?: { ascending?: boolean }) => ((order = `${ident(c)} ${o?.ascending === false ? "DESC" : "ASC"} NULLS LAST`), b),
      limit: (n: number) => ((lim = n), b),
      range: (a: number, z: number) => ((off = a), (lim = z - a + 1), b),
      maybeSingle: () => ((single = true), b),
      single: () => ((single = true), b),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve().then(exec).then(res, rej),
    };
    return b;
  };
  const rpc = async (fn: string, params: Record<string, unknown>) =>
    run(`SELECT to_json(public.${ident(fn)}(${Object.entries(params).map(([k, v]) => `${ident(k)} => ${lit(v)}`).join(", ")}))`);
  return { db: { from, rpc }, sql };
}
