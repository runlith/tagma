import { Layer } from 'effect';
import { SessionIdentity } from '../platform/contract/wire/session.js';
import type { HarnessAdapter } from './contract/service/adapter.js';
import type { HarnessAdapters } from './contract/service/adapters.js';
import { BUILTIN_HARNESSES } from './vendors/builtin.js';

export const sessionIdentityOf = (rows: readonly HarnessAdapter[]): SessionIdentity['Service'] => ({
  prefix: Object.fromEntries(rows.map((adapter) => [adapter.harness, adapter.prefix])),
  extras: [
    ...rows.flatMap((adapter) => (adapter.variable === undefined ? [] : [adapter.variable])),
    ...rows.flatMap((adapter) => adapter.exports ?? []),
  ],
});

export const harnessIdentity = (adapters: HarnessAdapters['Service']): SessionIdentity['Service'] => {
  let rows: readonly HarnessAdapter[] = [];
  let identity = sessionIdentityOf(rows);
  const current = (): SessionIdentity['Service'] => {
    const now = adapters.all();
    if (now.length !== rows.length || now.some((row, at) => row !== rows[at])) {
      rows = now;
      identity = sessionIdentityOf(now);
    }
    return identity;
  };
  return {
    get prefix() {
      return current().prefix;
    },
    get extras() {
      return current().extras;
    },
  };
};

export const sessionIdentity: SessionIdentity['Service'] = sessionIdentityOf(BUILTIN_HARNESSES);

export const sessionIdentityLayer: Layer.Layer<SessionIdentity> = Layer.succeed(SessionIdentity, sessionIdentity);
