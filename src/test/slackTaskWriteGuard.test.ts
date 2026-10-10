import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

/**
 * `sync-slack` must never create tasks.
 *
 * It runs every 15 minutes. A task write there compounds: an earlier version of this
 * function produced 907 task rows from 314 distinct titles in 18 hours, one of them
 * repeated 47 times. Task inflow now goes through `task_candidates` and the review
 * gate; the only writes `sync-slack` may make are `context_items`, its own Slack
 * bookkeeping tables, and `task_candidates` for a client_request in an external
 * client channel.
 *
 * This walks sync-slack and every local module it imports (transitively) and fails on
 * any insert/upsert whose target is `tasks`.
 */

const ENTRY = "supabase/functions/sync-slack/index.ts";

/**
 * `.from('tasks')` followed — within a few chained calls — by insert/upsert.
 * The gap may not contain another `.from(`: a read of `tasks` followed later by
 * an insert into a DIFFERENT table is not a task write, and matching it hid a
 * real signal behind a false alarm.
 */
const GAP = String.raw`(?:(?!\.from\()[\s\S]){0,200}?`;
const TASK_WRITE = [
  new RegExp(String.raw`\.from\(\s*['"\`]tasks['"\`]\s*\)${GAP}\.(insert|upsert)\s*\(`),
  new RegExp(String.raw`\.(insert|upsert)\s*\(${GAP}\)\s*\.from\(\s*['"\`]tasks['"\`]\s*\)`),
  /\.rpc\(\s*['"`][^'"`]*create_task[^'"`]*['"`]/,
];


function localImports(file: string, body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
    const resolved = normalize(join(dirname(file), m[1]));
    if (existsSync(resolved)) out.push(resolved);
  }
  return out;
}

function reachableFiles(entry: string): string[] {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f) || !existsSync(f)) continue;
    seen.add(f);
    stack.push(...localImports(f, readFileSync(f, "utf8")));
  }
  return [...seen];
}

describe("sync-slack task write guard", () => {
  it("sync-slack and its helpers never insert or upsert into tasks", () => {
    const offenders: string[] = [];
    for (const file of reachableFiles(ENTRY)) {
      const body = readFileSync(file, "utf8");
      for (const pattern of TASK_WRITE) {
        if (pattern.test(body)) offenders.push(`${file.replace(/\\/g, "/")} → writes to tasks`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the guard actually detects a task write", () => {
    const sample = `await supabase.from('tasks').insert({ title: 'x' });`;
    expect(TASK_WRITE.some((p) => p.test(sample))).toBe(true);
  });

  it("candidate promotion is switched off", () => {
    expect(readFileSync("supabase/functions/_shared/task-gate.ts", "utf8")).toMatch(/export const TASKS_FROM_REQUESTS_ONLY = true;/);
  });
});

describe("single task creation writer", () => {
  it("only the explicit-request writer inserts or upserts tasks", () => {
    // task-gate.ts keeps its (switched-off) promotion insert; TASKS_FROM_REQUESTS_ONLY guards it.
    const allowedFiles = new Set([normalize("supabase/functions/_shared/task-request.ts"), normalize("supabase/functions/_shared/task-gate.ts")]);
    const root = "supabase/functions";
    const stack = [root];
    const files: string[] = [];
    while (stack.length) {
      const dir = stack.pop();
      if (!dir) continue;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) stack.push(path);
        else if (entry.isFile() && path.endsWith(".ts")) files.push(path);
      }
    }
    const offenders = files.filter((file) => {
      if (allowedFiles.has(normalize(file))) return false;
      const body = readFileSync(file, "utf8");
      return TASK_WRITE.some((pattern) => pattern.test(body));
    });
    expect(offenders).toEqual([]);
  });

  it("candidate promotion is switched off", () => {
    expect(readFileSync("supabase/functions/_shared/task-gate.ts", "utf8")).toMatch(/export const TASKS_FROM_REQUESTS_ONLY = true;/);
  });
});
