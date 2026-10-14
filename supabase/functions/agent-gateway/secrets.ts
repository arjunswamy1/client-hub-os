// Secrets provider interface. The hub never stores secret values; providers
// resolve a pointer (e.g. op://vault/item/field) at call time, in memory only.
export type SecretResult =
  | { ok: true; value: string }
  | { ok: false; reason: 'not_configured' | 'invalid_ref' | 'unavailable' };

export interface SecretsProvider {
  readonly name: string;
  resolve(ref: string): Promise<SecretResult>;
}

/** Phase 1 stub: no 1Password licence yet, so every resolve reports not_configured. */
export class OnePasswordProvider implements SecretsProvider {
  readonly name = '1password';
  async resolve(ref: string): Promise<SecretResult> {
    if (!/^op:\/\/[^/\s]+\/[^/\s]+(\/[^/\s]+)+$/.test(ref)) return { ok: false, reason: 'invalid_ref' };
    return { ok: false, reason: 'not_configured' };
  }
}
