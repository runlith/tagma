import { Effect, Layer } from 'effect';
import type { Channel } from '../../installation/contract/wire/channel.js';
import { makeHarnessAdapters } from '../../external-harnesses/adapters.js';
import { HarnessAdapters } from '../../external-harnesses/contract/service/adapters.js';
import { installFailure } from '../../installation/contract/wire/install.js';
import { dataDirectory } from '../../installation/contract/wire/layout.js';
import { CurrentInvocation } from '../../platform/cli/verb.js';
import { harnessDeclarations } from './installedHarness.js';

export const installerAdapters = (channel: Channel) =>
  Layer.effect(
    HarnessAdapters,
    Effect.gen(function* () {
      const adapters = yield* makeHarnessAdapters;
      const data = dataDirectory(channel, (yield* CurrentInvocation).env);
      const providers = yield* Effect.tryPromise({
        try: () => harnessDeclarations(data, null, null),
        catch: installFailure,
      });
      yield* adapters.declared(providers);
      return adapters;
    }),
  );
