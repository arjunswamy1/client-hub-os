// Grokbot's Slack app. Same brain and guards as the hub bot, speaking with
// Grokbot's own token and signing secret, and draining the hub outbox through
// the mcp-hub outbox tools. persona.ts must be imported first.
import './persona.ts';
import '../_shared/slack-bot-app.ts';
