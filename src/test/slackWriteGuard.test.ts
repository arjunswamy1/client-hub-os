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
  "conversations.open",
  "files.upload",
  "files.completeUploadExternal",
  "files.getUploadURLExternal",
];

const ALLOWED = ["supabase/functions/_shared/slack-post.ts"];

/**
 * Files allowed to build a Slack API URL dynamically. Only read-only helpers
 * belong here — the posting helper, sync-slack's `slackRead` wrapper, and the
 * feedback capture poller (conversations.replies / reactions.get / getPermalink,
 * all reads; feedbackSafety.test.ts asserts it calls no write method).
 */
const DYNAMIC_URL_ALLOWED = [
  "supabase/functions/_shared/slack-post.ts",
  "supabase/functions/sync-slack/index.ts",
  "supabase/functions/capture-slack-feedback/index.ts",
];


/**
 * A dynamically built method name (`api/${m}`) hides the literal, so also flag
 * any Slack API URL whose method segment is an interpolation or concatenation.
 */
const DYNAMIC_SLACK_URL = [
  /slack\.com\/api\/\$\{/,
  /slack\.com\/api\/["'`]?\s*\+/,
  /["'`]https:\/\/slack\.com\/api\/?["'`]\s*\+/,
];

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
      // Unconditional: a dynamically built method name hides the literal, so any
      // file outside the explicit allowlist is an offender.
      if (!DYNAMIC_URL_ALLOWED.includes(rel)) {
        for (const pattern of DYNAMIC_SLACK_URL) {
          if (pattern.test(body)) offenders.push(`${rel} → dynamically constructed Slack API URL`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("slack-post.ts exports exactly two writers: postToSlack and postDirectMessage", () => {
    const body = readFileSync("supabase/functions/_shared/slack-post.ts", "utf8");
    const exported = [...body.matchAll(/export\s+async\s+function\s+(\w+)/g)].map((m) => m[1]).sort();
    // canPostToChannel and botSettings are read-only, not writers.
    expect(exported).toEqual(["botSettings", "canPostToChannel", "postDirectMessage", "postToSlack"]);
  });

  it("no file outside slack-post.ts posts to a Slack response_url", () => {
    const offenders: string[] = [];
    for (const file of [...walk("src"), ...walk("supabase/functions")]) {
      const rel = file.replace(/\\/g, "/");
      if (ALLOWED.includes(rel) || rel.startsWith("src/test/")) continue;
      const body = readFileSync(file, "utf8");
      if (/fetch\(\s*[\w.]*response_?url/i.test(body) || body.includes("hooks.slack.com")) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("the guard catches a writer outside the module", () => {
    const fake = "await fetch('https://slack.com/api/chat.postMessage', {})";
    const hit = WRITE_METHODS.some((m) => fake.includes(`slack.com/api/${m}`));
    const dyn = DYNAMIC_SLACK_URL.some((p) => p.test("fetch(`https://slack.com/api/${m}`)"));
    expect(hit).toBe(true);
    expect(dyn).toBe(true);
  });
});
