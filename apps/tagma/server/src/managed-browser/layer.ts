import { Effect, Layer } from 'effect';
import { Hosts } from '../browser/contract/service/hosts.js';
import { makeManagedHost } from './host.js';

export const managedLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const hosts = yield* Hosts;
    yield* hosts.attach(yield* makeManagedHost);
  }),
);
