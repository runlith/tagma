import { Effect, Layer, Schedule, Semaphore, Stream } from 'effect';
import type { HarnessProvider } from '@runlith/tagma/adapter/provider';
import { Maintenance } from '../platform/contract/service/maintenance.js';
import { NATIVE_HARNESS, type HarnessId } from '../platform/contract/wire/session.js';
import { ProviderRegistry } from '../providers/contract/service/registry.js';
import { ThreadHarness } from '../threads/contract/service/engine.js';
import { HarnessRegistry } from '../threads/contract/service/harness.js';
import { LEASE_RHYTHM } from '../threads/contract/wire/rhythm.js';
import type { HarnessAdapter } from './contract/service/adapter.js';
import { HarnessAdapters } from './contract/service/adapters.js';
import { HarnessImplementations } from './contract/service/sessionPorts.js';
import { settingWritesLayer } from './settingWrites.js';

const contributions = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* HarnessRegistry;
    const implementations = yield* HarnessImplementations;
    const adapters = yield* HarnessAdapters;
    const providers = yield* ProviderRegistry;
    const native = yield* registry.resolve(NATIVE_HARNESS as HarnessId).pipe(Effect.orDie);
    const bound = new Map<string, HarnessAdapter>();
    const follow = Effect.suspend(() => {
      const rows = new Map(adapters.all().map((row) => [row.harness, row]));
      const acts: Effect.Effect<void>[] = [];
      for (const [id, row] of rows) {
        const standing = bound.get(id);
        if (standing === row) continue;
        const implementation = implementations(row, native.retract);
        acts.push(
          standing === undefined ? registry.register(id as HarnessId, implementation) : registry.replace(id as HarnessId, implementation),
        );
        bound.set(id, row);
      }
      for (const id of [...bound.keys()]) {
        if (rows.has(id)) continue;
        acts.push(registry.withdraw(id as HarnessId));
        bound.delete(id);
      }
      return Effect.all(acts, { discard: true });
    });
    const lock = yield* Semaphore.make(1);
    const settle = (harnesses: readonly HarnessProvider[]) => lock.withPermits(1)(Effect.andThen(adapters.declared(harnesses), follow));
    yield* settle(providers.current().harnesses);
    yield* Effect.forkScoped(Stream.runForEach(providers.changes, (catalog) => settle(catalog.harnesses)));
  }),
);

const resources = Layer.effectDiscard(
  Effect.gen(function* () {
    const harness = yield* ThreadHarness;
    const { opened } = yield* Maintenance;
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

export const externalServingLayer = Layer.mergeAll(contributions, resources, settingWritesLayer);
