import { Effect, Layer, Schedule } from 'effect';
import { Maintenance } from '../platform/contract/service/maintenance.js';
import { NATIVE_HARNESS, type HarnessId } from '../platform/contract/wire/session.js';
import { ThreadHarness } from '../threads/contract/service/engine.js';
import { HarnessRegistry } from '../threads/contract/service/harness.js';
import { HARNESS_NAMES } from '../threads/contract/wire/harness/names.js';
import { LEASE_RHYTHM } from '../threads/contract/wire/rhythm.js';
import { HarnessImplementations } from './contract/service/sessionPorts.js';

export const externalServingLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* HarnessRegistry;
    const implementations = yield* HarnessImplementations;
    const harness = yield* ThreadHarness;
    const { opened } = yield* Maintenance;
    const native = yield* registry.resolve(NATIVE_HARNESS as HarnessId).pipe(Effect.orDie);
    for (const name of HARNESS_NAMES) {
      yield* registry.register(name as HarnessId, implementations(name, native.retract));
    }
    for (const transport of harness.runs.transports().all()) {
      const resource = transport.resource;
      if (resource === undefined) continue;
      yield* Effect.forkScoped(
        opened.pipe(
          Effect.andThen(resource.watch()),
          Effect.tapError((failure) =>
            Effect.logWarning('a transport resource could not be watched; trying again', { adapter: transport.adapter, failure }),
          ),
          Effect.retry(Schedule.spaced(LEASE_RHYTHM.takeoverAfterMs)),
        ),
      );
    }
  }),
);
