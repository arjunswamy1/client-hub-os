import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const outbox = readFileSync('supabase/functions/mcp-hub/outbox.ts', 'utf8');
const post = readFileSync('supabase/functions/_shared/slack-post.ts', 'utf8');

describe('Grokbot outbox', () => {
  it('mcp-hub outbox never imports the Slack writer', () => {
    expect(outbox).not.toMatch(/from ['"][^'"]*slack-post/);
  });
  it('outbox tools refuse non-service callers', () => {
    expect(outbox).toMatch(/if \(!caller\.isService\) throw new ToolRefusal/);
  });
  it('posts are queued only after the channel allowlist check', () => {
    const guard = post.indexOf('refusalReason(opts.channel');
    const queue = post.indexOf("from('slack_outbox')");
    expect(guard).toBeGreaterThan(-1);
    expect(queue).toBeGreaterThan(guard);
  });
});
