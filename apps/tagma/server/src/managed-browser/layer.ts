import { currentPlatform } from '@runlith/chrome-for-testing/launch';
import { Effect, Layer } from 'effect';
import { LaunchPlatform } from './contract/service/launch.js';
import { Hosts } from '../browser/contract/service/hosts.js';
import { makeManagedHost } from './host.js';

export const managedLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const hosts = yield* Hosts;
    yield* hosts.attach(yield* makeManagedHost);
  }),
).pipe(Layer.provide(Layer.sync(LaunchPlatform, currentPlatform)));
