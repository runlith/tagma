import { join } from 'node:path';
import { Effect, Layer } from 'effect';
import { CHANNEL } from '@tagma/server/composition/channel';
import { makeHarnessAdapters } from '../../external-harnesses/adapters.js';
import { HarnessAdapters } from '../../external-harnesses/contract/service/adapters.js';
import { installFailure } from '../../installation/contract/wire/install.js';
import { ADAPTERS, dataDirectory } from '../../installation/contract/wire/layout.js';
import { CurrentInvocation } from '../../platform/cli/verb.js';
import { harnessDeclarations } from './installedHarness.js';

export const installerAdapters = Layer.effect(
  HarnessAdapters,
  Effect.gen(function* () {
    const adapters = yield* makeHarnessAdapters;
    const data = dataDirectory(CHANNEL, (yield* CurrentInvocation).env);
    const providers = yield* Effect.tryPromise({
      try: () => harnessDeclarations(data === null ? null : join(data, ADAPTERS), null, null),
      catch: installFailure,
    });
    yield* adapters.declared(providers);
    return adapters;
  }),
);
