import { join } from 'node:path';
import { Effect, Layer } from 'effect';
import { CHANNEL } from '@tagma/server/composition/channel';
import { makeHarnessAdapters } from '../../external-harnesses/adapters.js';
import { HarnessAdapters } from '../../external-harnesses/contract/service/adapters.js';
import { installFailure } from '../../installation/contract/wire/install.js';
import { ADAPTERS, dataDirectory } from '../../installation/contract/wire/layout.js';
import { CurrentInvocation } from '../../platform/cli/verb.js';
import { installedHarnesses } from './installedHarness.js';

export const installerAdapters = Layer.effect(
  HarnessAdapters,
  Effect.gen(function* () {
    const adapters = yield* makeHarnessAdapters;
    const data = dataDirectory(CHANNEL, (yield* CurrentInvocation).env);
    if (data === null) return adapters;
    const providers = yield* Effect.tryPromise({ try: () => installedHarnesses(join(data, ADAPTERS)), catch: installFailure });
    yield* adapters.declared(providers);
    return adapters;
  }),
);
