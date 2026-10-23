import { assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
// Source-level guard: this function may only send new DMs. Fails the suite if anyone adds another Slack path.
const src = (await Deno.readTextFile(new URL('./index.ts', import.meta.url))) + (await Deno.readTextFile(new URL('./drain.ts', import.meta.url)));
Deno.test('agent-alert-slack: DM send only, no other Slack/bot-token use', () => {
  for (const banned of ['postToSlack', 'canPostToChannel', 'getValidBotToken', 'slack-token', "kind: 'update'", "kind: 'interaction_reply'", 'chat.postMessage', 'files.', 'thread_ts', 'responseUrl', 'channel:', 'SLACK_BOT_TOKEN', 'GROKBOT_BOT_TOKEN', 'fetch(']) {
    assert(!src.includes(banned), `banned: ${banned}`);
  }
  assert((src.match(/postDirectMessage\(/g) ?? []).length === 1, 'exactly one postDirectMessage call');
  assert(/import \{ postDirectMessage \} from '\.\.\/_shared\/slack-post\.ts'/.test(src), 'only postDirectMessage imported');
});
