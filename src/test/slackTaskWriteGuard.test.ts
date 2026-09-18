import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
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

/** `.from('tasks')` followed — within a few chained calls — by insert/upsert. */
const TASK_WRITE = [
  /\.from\(\s*['"`]tasks['"`]\s*\)[\s\S]{0,200}?\.(insert|upsert)\s*\(/,
  /\.(insert|upsert)\s*\([\s\S]{0,200}?\)\s*\.from\(\s*['"`]tasks['"`]\s*\)/,
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
});
