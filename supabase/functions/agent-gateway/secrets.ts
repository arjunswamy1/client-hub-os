// Secrets provider interface. The hub never stores secret values; providers
// resolve a pointer (op://vault/item/field) at call time, in memory only.
// Nothing here logs, caches to the database, or returns provider error text.
export type SecretResult =
  | { ok: true; value: string }
  | { ok: false; reason: 'not_configured' | 'invalid_ref' | 'unavailable' };

export interface ReachabilityResult { token_present: boolean; reachable: boolean; vault_count?: number; reference_resolves?: boolean; reason?: string }

export interface SecretsProvider {
  readonly name: string;
  resolve(ref: string): Promise<SecretResult>;
  check(ref?: string): Promise<ReachabilityResult>;
}

export const OP_REF = /^op:\/\/[^/\s]+\/[^/\s]+(\/[^/\s]+)+$/;

/** Minimal surface of the 1Password SDK client we use. */
export interface OpClient {
  secrets: { resolve(ref: string): Promise<string> };
  vaults: { list?: () => Promise<unknown>; listAll?: () => Promise<unknown> };
}
export type OpClientFactory = (token: string) => Promise<OpClient>;

const defaultFactory: OpClientFactory = async (token) => {
  const sdk: any = await import('npm:@1password/sdk@0.3.1');
  return await sdk.createClient({ auth: token, integrationName: 'CPM Hub Agent Gateway', integrationVersion: 'v1.0.0' });
};

async function countVaults(c: OpClient): Promise<number> {
  const r: any = c.vaults.list ? await c.vaults.list() : await c.vaults.listAll!();
  if (Array.isArray(r)) return r.length;
  if (r && typeof r[Symbol.asyncIterator] === 'function') { let n = 0; for await (const _ of r) n++; return n; }
  if (r && Array.isArray(r.elements)) return r.elements.length;
  return 0;
}

export class OnePasswordProvider implements SecretsProvider {
  readonly name = '1password';
  private client: Promise<OpClient> | null = null; // per-request instance only
  constructor(private token: string | undefined = Deno.env.get('OP_SERVICE_ACCOUNT_TOKEN'), private factory: OpClientFactory = defaultFactory) {}

  private getClient(): Promise<OpClient> {
    if (!this.client) this.client = this.factory(this.token!);
    return this.client;
  }

  async resolve(ref: string): Promise<SecretResult> {
    if (!this.token) return { ok: false, reason: 'not_configured' };
    if (!OP_REF.test(ref)) return { ok: false, reason: 'invalid_ref' };
    try {
      const value = await (await this.getClient()).secrets.resolve(ref);
      if (typeof value !== 'string' || !value) return { ok: false, reason: 'unavailable' };
      return { ok: true, value };
    } catch {
      return { ok: false, reason: 'unavailable' }; // provider text is never surfaced
    }
  }

  async check(ref?: string): Promise<ReachabilityResult> {
    if (!this.token) return { token_present: false, reachable: false, reason: 'not_configured' };
    let client: OpClient;
    try { client = await this.getClient(); } catch { return { token_present: true, reachable: false, reason: 'sign_in_failed' }; }
    const out: ReachabilityResult = { token_present: true, reachable: false };
    try { out.vault_count = await countVaults(client); out.reachable = true; } catch { out.reason = 'vault_list_failed'; }
    if (ref !== undefined) {
      if (!OP_REF.test(ref)) out.reference_resolves = false, out.reason = out.reason ?? 'invalid_ref';
      else {
        try { const v = await client.secrets.resolve(ref); out.reference_resolves = typeof v === 'string' && v.length > 0; out.reachable = true; }
        catch { out.reference_resolves = false; }
      }
    }
    return out;
  }
}
