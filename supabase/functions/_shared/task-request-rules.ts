// Pure rules for the only two ways a task enters the tracker:
//   1. a Slack message that tags CPM Bot and asks for a task;
//   2. a recording where someone explicitly says to put it in the tracker / tells CPM Bot.
// Nothing else (client requests, meeting "next steps", intake messages) creates a task.

const VERB = '(?:add|create|make|log|record|put|open|track|set up|throw|drop|capture|note)';
const NOUN = '(?:task|tasks|to-?do|ticket|action item)';

/** Slack: text with the bot mention already stripped. */
export function isSlackTaskRequest(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  if (/^(?:new\s+)?(?:task|to-?do)\b\s*(?:for\b|[:\-–—])/i.test(t)) return true;
  if (new RegExp(`\\b${VERB}\\b[^.?!\\n]{0,60}\\b${NOUN}\\b`, 'i').test(t)) return true;
  if (/\b(?:task|tracker)\b[^.?!\n]{0,20}\bfor\s+\w+/i.test(t) && /\b(?:add|create|log|record|put)\b/i.test(t)) return true;
  if (/\b(?:in|on|to)\s+the\s+task\s*tracker\b/i.test(t)) return true;
  return false;
}

const SPOKEN_ADDRESS = /\b(?:cpm|c\.?\s?p\.?\s?m\.?)[\s-]*bot\b/i;
const SPOKEN_TRACKER = /\btask\s*(?:tracker|list|board)\b/i;
const SPOKEN_VERB = new RegExp(`\\b(?:${VERB.slice(3, -1)}|remember|remind)\\b`, 'i');

export interface SpokenRequest { line_index: number; quote: string; context: string }

/**
 * Recordings: a line counts only when it addresses CPM Bot or names the task
 * tracker AND carries a request verb. Context is the line plus the next two,
 * because people often say "CPM Bot, add a task:" and then the task.
 */
export function findSpokenTaskRequests(transcript: string): SpokenRequest[] {
  const lines = (transcript || '').split(/\r?\n|(?<=[.?!])\s+(?=[A-Z])/).map((l) => l.trim()).filter(Boolean);
  const out: SpokenRequest[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const addressed = SPOKEN_ADDRESS.test(l) || SPOKEN_TRACKER.test(l);
    if (!addressed || !SPOKEN_VERB.test(l)) continue;
    if (out.length && i - out[out.length - 1].line_index <= 1) continue; // same request continuing
    out.push({ line_index: i, quote: l.slice(0, 500), context: lines.slice(i, i + 3).join(' ').slice(0, 1500) });
  }
  return out;
}
