// A minimal in-memory stand-in for the Supabase query builder, enough for the
// read paths of the metric engine. Every query is recorded so tests can assert
// which filters a read applied (e.g. client_id on shared call tables).
type Row = Record<string, any>;

export interface RecordedQuery { table: string; filters: [string, string, unknown][]; op: "select" | "insert" | "update" }

export function fakeDb(tables: Record<string, Row[]>) {
  const queries: RecordedQuery[] = [];
  const from = (table: string) => {
    const q: RecordedQuery = { table, filters: [], op: "select" };
    queries.push(q);
    let order: { col: string; asc: boolean } | null = null;
    let lim: number | null = null;
    let rng: [number, number] | null = null;
    let single = false;
    const cmp = (a: unknown, b: unknown) => String(a ?? "") .localeCompare(String(b ?? ""));
    const run = () => {
      let rows = (tables[table] ?? []).filter((r) => q.filters.every(([op, col, v]) => {
        const x = r[col];
        switch (op) {
          case "eq": return x === v;
          case "neq": return x !== v;
          case "is": return v === null ? x === null || x === undefined : x === v;
          case "gt": return typeof v === "number" ? Number(x) > v : cmp(x, v) > 0;
          case "gte": return cmp(x, v) >= 0;
          case "lt": return cmp(x, v) < 0;
          case "lte": return cmp(x, v) <= 0;
          case "in": return (v as unknown[]).includes(x);
          default: return true;
        }
      }));
      if (order) { const o = order; rows = rows.slice().sort((a, b) => (o.asc ? 1 : -1) * cmp(a[o.col], b[o.col])); }
      if (rng) rows = rows.slice(rng[0], rng[1] + 1);
      if (lim !== null) rows = rows.slice(0, lim);
      return single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null };
    };
    const b: any = {
      select: () => b,
      insert: (rows: Row | Row[]) => { q.op = "insert"; (tables[table] ??= []).push(...(Array.isArray(rows) ? rows : [rows])); return b; },
      update: () => { q.op = "update"; return b; },
      eq: (c: string, v: unknown) => (q.filters.push(["eq", c, v]), b),
      neq: (c: string, v: unknown) => (q.filters.push(["neq", c, v]), b),
      is: (c: string, v: unknown) => (q.filters.push(["is", c, v]), b),
      gt: (c: string, v: unknown) => (q.filters.push(["gt", c, v]), b),
      gte: (c: string, v: unknown) => (q.filters.push(["gte", c, v]), b),
      lt: (c: string, v: unknown) => (q.filters.push(["lt", c, v]), b),
      lte: (c: string, v: unknown) => (q.filters.push(["lte", c, v]), b),
      in: (c: string, v: unknown[]) => (q.filters.push(["in", c, v]), b),
      or: () => b,
      order: (col: string, o?: { ascending?: boolean }) => ((order = { col, asc: o?.ascending !== false }), b),
      limit: (n: number) => ((lim = n), b),
      range: (a: number, z: number) => ((rng = [a, z]), b),
      maybeSingle: () => ((single = true), b),
      single: () => ((single = true), b),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  };
  return { db: { from }, queries };
}
