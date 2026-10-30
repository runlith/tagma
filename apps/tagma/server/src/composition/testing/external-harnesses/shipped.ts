import { Effect, Layer } from 'effect';
import { makeHarnessAdapters } from '../../../external-harnesses/adapters.js';
import { HarnessAdapters } from '../../../external-harnesses/contract/service/adapters.js';
import { BUILTIN_HARNESS_PROVIDERS } from '../../adapters.js';

export const shippedAdapters = Effect.gen(function* () {
  const adapters = yield* makeHarnessAdapters;
  const providers = yield* Effect.promise(() => Promise.all([...BUILTIN_HARNESS_PROVIDERS.values()].map(({ load }) => load())));
  yield* adapters.declared(providers);
  return adapters;
});

export const shippedAdaptersLayer = Layer.effect(HarnessAdapters, shippedAdapters);
