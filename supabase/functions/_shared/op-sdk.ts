// The only file that loads the 1Password SDK (kept out of unit tests).
import { createClient } from 'npm:@1password/sdk@0.5.0';
import type { OpClientFactory } from './agent-secrets.ts';

export const opSdkFactory: OpClientFactory = async (token) =>
  (await createClient({ auth: token, integrationName: 'CPM Hub Agent Gateway', integrationVersion: 'v1.0.0' })) as any;
