import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Slack writes must go through supabase/functions/_shared/slack-post.ts, which
 * enforces the fail-closed channel allowlist. If a future code path calls a
 * Slack write method directly it bypasses the guard, so this test fails.
 */
const WRITE_METHODS = [
  "chat.postMessage",
  "chat.update",
  "chat.postEphemeral",
  "reactions.add",
  "files.completeUploadExternal",
  "files.getUploadURLExternal",
];

const ALLOWED = ["supabase/functions/_shared/slack-post.ts"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("Slack write guard", () => {
  it("no source file outside slack-post.ts calls a Slack write method", () => {
    const offenders: string[] = [];
    for (const file of [...walk("src"), ...walk("supabase/functions")]) {
      const rel = file.replace(/\\/g, "/");
      if (ALLOWED.includes(rel)) continue;
      if (rel === "src/test/slackWriteGuard.test.ts") continue;
      const body = readFileSync(file, "utf8");
      for (const method of WRITE_METHODS) {
        if (body.includes(`slack.com/api/${method}`) || body.includes(`api/${method}`)) {
          offenders.push(`${rel} → ${method}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
