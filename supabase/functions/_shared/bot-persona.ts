// Which Slack app this function isolate speaks as. The grokbot entry point sets
// it before importing the shared bot; every other function stays 'cpm'.
export type BotPersona = 'cpm' | 'grokbot';

export function setBotPersona(p: BotPersona) {
  (globalThis as any).__BOT_PERSONA = p;
}

export function botPersona(): BotPersona {
  return (globalThis as any).__BOT_PERSONA === 'grokbot' ? 'grokbot' : 'cpm';
}
