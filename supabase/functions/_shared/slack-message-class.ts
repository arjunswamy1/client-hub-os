// Single place where a Slack message is turned into a message_class.
// Deterministic and pure so it can be unit-tested; sync-slack is the only caller.
//
// Classes: client_question | client_request | escalation | client_claim | internal | noise
// NOTE: every class is stored, including noise. Classification decides what a
// person is shown later, never what we keep.

export type MessageClass =
  | 'client_question'
  | 'client_request'
  | 'escalation'
  | 'client_claim'
  | 'internal'
  | 'noise';

const NOISE_ONLY = /^(?:\s*(?::[a-z0-9_+-]+:|👍|🙏|✅|🎉|❤️|😂|🔥|thanks?|thank you|thx|ty|ok|okay|k|got it|sounds good|great|perfect|nice|cool|yes|yep|no|nope|morning|good morning|good afternoon|good evening|hi|hey|hello|np|sure|will do|done|\p{Emoji_Presentation}|[!.,])\s*)+$/iu;

const SCHEDULING = /\b(?:calendar|reschedul|standup|stand-up|see you (?:then|tomorrow|monday)|jump on a call|zoom link|meet(?:ing)? (?:link|invite)|out of office|ooo|pto|on vacation)\b/i;

const ESCALATION = /(?:\basap\b|\burgent(?:ly)?\b|\bescalat\w*|\bunacceptable\b|\bfrustrat\w*|\bcomplain\w*|\bangry\b|\bupset\b|\bdisappoint\w*|\bridiculous\b|\bstill (?:not|no|haven'?t|hasn'?t|waiting)\b|\bthird time\b|\bagain\?\b|!{2,})/i;

const REQUEST = /(?:\bplease\b|\bcan you\b|\bcould you\b|\bwould you\b|\bcan we\b|\bneed (?:you )?to\b|\bwe need\b|\bi need\b|\bsend (?:me|us|over)\b|\bpull\b|\bturn (?:off|on)\b|\bpause\b|\bswitch off\b|\bincrease\b|\bdecrease\b|\bset up\b|\badd\b|\bremove\b|\bupdate\b|\bfix\b|\blet'?s\b|\bmake sure\b|\bhold off\b)/i;

const QUESTION_WORD = /^(?:\s*)(?:who|what|when|where|why|how|which|is|are|was|were|do|does|did|can|could|should|would|will|any|anyone|got)\b/i;

// A claim asserts a number or fact of ours we could check against our own data.
const CLAIM_NUMBER = /(?:\$\s?\d|\d+\s?%|\b\d{2,}\b|\b\d+(?:\.\d+)?\s*(?:calls?|leads?|conversions?|clicks?|cpl|cpa|roas|sales?|hours?)\b)/i;
const CLAIM_VOICE = /\b(?:we|we'?re|our|us|i|i'?m|my|showing|shows|showed|seeing|saw|got|received|only|just)\b/i;

// An unambiguous ask, which outranks a question mark.
const EXPLICIT_ASK = /(?:\bplease\b|\bcan you\b|\bcould you\b|\bwould you\b|\bcan we\b|\bneed (?:you )?to\b|\bwe need\b|\bi need\b|\bsend (?:me|us|over)\b|\blet'?s\b|\bmake sure\b|\bhold off\b|\bturn (?:off|on)\b|\bpause\b)/i;

export interface ClassifyInput {
  text: string;
  isCpmAuthor: boolean;
}

export function classifyMessage({ text, isCpmAuthor }: ClassifyInput): MessageClass {
  if (isCpmAuthor) return 'internal';

  const t = (text || '').trim();
  if (t === '') return 'noise';
  if (NOISE_ONLY.test(t)) return 'noise';
  if (SCHEDULING.test(t) && !/\?/.test(t)) return 'noise';

  if (ESCALATION.test(t)) return 'escalation';
  // An explicit ask ("please", "can you") is a request even when phrased as a
  // question; anything else interrogative is a question.
  if (EXPLICIT_ASK.test(t)) return 'client_request';
  if (/\?/.test(t) || QUESTION_WORD.test(t)) return 'client_question';
  if (REQUEST.test(t)) return 'client_request';
  if (CLAIM_NUMBER.test(t) && CLAIM_VOICE.test(t)) return 'client_claim';
  return 'noise';
}
