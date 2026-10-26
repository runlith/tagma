import { Effect, PubSub, type Scope, Stream } from 'effect';
import type { StoreFailure } from '../platform/contract/service/store.js';
import type { SettableScope, SettingKey } from '../platform/contract/wire/setting.js';
import { SettingChanges, type SettingChanged } from './contract/service/changes.js';
import { resolveSetting, type SettingLayer } from './resolution.js';

type LiveValue = {
  readonly projectId?: number;
  update(layer: SettingLayer): void;
};

export const liveOf = (layers: (projectId?: number) => Effect.Effect<SettingLayer[], StoreFailure>) => {
  const liveValues = new Map<string, Set<LiveValue>>();
  const holdings = new Map<string, () => unknown>();
  const subscribers = new Set<(event: SettingChanged) => Effect.Effect<void>>();

  const settingChanges = SettingChanges.of({
    publish: (event) => Effect.forEach([...subscribers], (subscriber) => subscriber(event), { discard: true }),
    subscribe: (subscriber) => {
      subscribers.add(subscriber);
      return () => {
        subscribers.delete(subscriber);
      };
    },
  });

  const enrol = (keyId: string, reader: LiveValue): (() => void) => {
    let readers = liveValues.get(keyId);
    if (readers === undefined) {
      readers = new Set();
      liveValues.set(keyId, readers);
    }
    const standing = readers;
    standing.add(reader);
    return () => {
      standing.delete(reader);
      if (standing.size === 0) liveValues.delete(keyId);
    };
  };

  const watching = Effect.fnUntraced(function* (keyId: string, reader: LiveValue): Effect.fn.Return<void, never, Scope.Scope> {
    const leave = enrol(keyId, reader);
    yield* Effect.addFinalizer(() => Effect.sync(leave));
  });

  const standingValue = <A>(key: SettingKey<A>) => Effect.map(layers(), (chain) => resolveSetting(key, chain).value);

  const live = Effect.fnUntraced(function* <A>(key: SettingKey<A>): Effect.fn.Return<() => A, StoreFailure, Scope.Scope> {
    let current = key.fallback;
    let changed = false;
    yield* watching(key.id, {
      update: (layer) => {
        changed = true;
        current = resolveSetting(key, [layer]).value;
      },
    });
    const standing = yield* standingValue(key);
    if (!changed) current = standing;
    return () => current;
  });

  const changes = Effect.fnUntraced(function* <A>(key: SettingKey<A>): Effect.fn.Return<Stream.Stream<A>, StoreFailure, Scope.Scope> {
    const published = yield* Effect.acquireRelease(PubSub.sliding<A>({ capacity: 1, replay: 1 }), PubSub.shutdown);
    let changed = false;
    yield* watching(key.id, {
      update: (layer) => {
        changed = true;
        published.pubsub.slide();
        PubSub.publishUnsafe(published, resolveSetting(key, [layer]).value);
      },
    });
    const standing = yield* standingValue(key);
    if (!changed) yield* PubSub.publish(published, standing);
    return Stream.fromSubscription(yield* PubSub.subscribe(published));
  });

  const held = <A>(key: SettingKey<A>, projectId: number): Effect.Effect<() => A, StoreFailure> =>
    Effect.suspend(() => {
      const at = `${key.id}\u0000${projectId}`;
      const standing = holdings.get(at);
      if (standing !== undefined) return Effect.succeed(standing as () => A);
      const chain = new Map<SettableScope, SettingLayer>();
      const changed = new Set<SettableScope>();
      let current = key.fallback;
      const leave = enrol(key.id, {
        projectId,
        update: (layer) => {
          changed.add(layer.scope);
          chain.set(layer.scope, layer);
          current = resolveSetting(key, [...chain.values()]).value;
        },
      });
      return layers(projectId).pipe(
        Effect.map((read) => {
          for (const layer of read) if (!changed.has(layer.scope)) chain.set(layer.scope, layer);
          current = resolveSetting(key, [...chain.values()]).value;
          const raced = holdings.get(at);
          if (raced !== undefined) {
            leave();
            return raced as () => A;
          }
          const reading = () => current;
          holdings.set(at, reading as () => unknown);
          return reading;
        }),
        Effect.onError(() => Effect.sync(leave)),
      );
    });

  const publish = (keyId: string, scope: SettableScope, projectId: number | null, stored: string | null, declined: boolean): void => {
    const readers = liveValues.get(keyId);
    if (readers === undefined) return;
    const values = new Map<string, unknown>();
    if (stored !== null) values.set(keyId, JSON.parse(stored));
    const layer: SettingLayer = {
      scope,
      values,
      declined: declined ? new Set([keyId]) : new Set(),
      writers: new Map(),
    };
    for (const reader of readers) {
      if (scope === 'project' && reader.projectId !== projectId) continue;
      reader.update(layer);
    }
  };

  return { live, held, changes, publish, settingChanges };
};
