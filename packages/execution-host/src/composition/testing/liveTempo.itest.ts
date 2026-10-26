import * as BunServices from '@effect/platform-bun/BunServices';
import { Effect, Layer } from 'effect';
import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { Adapter } from '../../holder/testing/Adapter';
import { testHolder } from '../../posix/testing/holder';
import { hostPolicy, hostShare, hostWireLimits } from '../../hostFixture';
import { liveTempoContracts } from './liveTempo';
import { makeWorld } from './servedWorld';
import { Host, operation } from './session';
import { posix } from './posix';

const policy = hostPolicy({ executions: 2 });
const limits = hostWireLimits(policy, 2, { envelopeBytes: 1024 * 1024, connections: 2, requests: 4 });
const services = Layer.effect(
  Host,
  Effect.gen(function* () {
    const platform = yield* Adapter;
    const { client, registration } = yield* makeWorld({
      prefix: 'tempo-',
      directory: platform.directory,
      policy,
      share: hostShare(policy, 2),
      limits,
      holder: (state) => testHolder(state, undefined, undefined, true),
    });
    const unavailable = Effect.die(new Error('the live tempo fixture does not replace its logic or holder'));
    const host = Host.of({
      client,
      installation: registration.installation,
      credits: limits.credits,
      control: { restartLogic: unavailable, yieldLogic: unavailable, loseHolder: unavailable },
    });
    const taken = yield* client.take(yield* operation(host), 0);
    if (taken._tag !== 'Held') return yield* Effect.die(new Error(`custody: ${taken._tag}`));
    return host;
  }),
).pipe(
  Layer.provideMerge(posix()),
  Layer.provide(HostRegistration.layer),
  Layer.provide(endpointConnection),
  Layer.provide(BunServices.layer),
);

liveTempoContracts({
  name: 'POSIX',
  steps: { hangup: 'hang-up', interrupt: 'interrupt', terminate: 'terminate', kill: 'kill' },
  layer: services,
});
