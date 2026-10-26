import { Layer } from 'effect';
import { SessionIdentity } from '../platform/contract/wire/session.js';
import { HARNESSES, harnessAdapter } from './contract/service/table.js';
import type { HarnessName } from '../threads/contract/wire/harness/names.js';

const prefixOf = (harness: HarnessName): string => harnessAdapter(harness).prefix;

export const sessionIdentity: SessionIdentity['Service'] = {
  prefix: Object.fromEntries(HARNESSES.map((adapter) => [adapter.harness, prefixOf(adapter.harness)])),
  extras: [
    ...HARNESSES.flatMap((adapter) => (adapter.variable === undefined ? [] : [adapter.variable])),
    ...HARNESSES.flatMap((adapter) => adapter.exports ?? []),
  ],
};

export const sessionIdentityLayer: Layer.Layer<SessionIdentity> = Layer.succeed(SessionIdentity, sessionIdentity);
