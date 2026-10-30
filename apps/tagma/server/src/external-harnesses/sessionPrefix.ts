import { Layer } from 'effect';
import { SessionIdentity } from '../platform/contract/wire/session.js';
import { BUILTIN_HARNESSES } from './vendors/builtin.js';

export const sessionIdentity: SessionIdentity['Service'] = {
  prefix: Object.fromEntries(BUILTIN_HARNESSES.map((adapter) => [adapter.harness, adapter.prefix])),
  extras: [
    ...BUILTIN_HARNESSES.flatMap((adapter) => (adapter.variable === undefined ? [] : [adapter.variable])),
    ...BUILTIN_HARNESSES.flatMap((adapter) => adapter.exports ?? []),
  ],
};

export const sessionIdentityLayer: Layer.Layer<SessionIdentity> = Layer.succeed(SessionIdentity, sessionIdentity);
