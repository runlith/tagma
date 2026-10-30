import { Effect, Layer, PubSub, Stream } from 'effect';
import type { HarnessProvider } from '@runlith/tagma/adapter/provider';
import { declaredHarness } from './adapter/declared.js';
import type { HarnessAdapter } from './contract/service/adapter.js';
import { HarnessAdapters } from './contract/service/adapters.js';
import { harnessNotInstalled } from '../threads/contract/service/harness.js';
import { BUILTIN_HARNESSES } from './vendors/builtin.js';

const same = (left: ReadonlyMap<string, HarnessAdapter>, right: ReadonlyMap<string, HarnessAdapter>): boolean =>
  left.size === right.size && [...left].every(([id, row]) => right.get(id) === row);

export const makeHarnessAdapters = Effect.gen(function* () {
  const made = new WeakMap<HarnessProvider, HarnessAdapter | null>();
  const rowsOf = (providers: readonly HarnessProvider[]): ReadonlyMap<string, HarnessAdapter> => {
    const next = new Map(BUILTIN_HARNESSES.map((row) => [row.harness, row]));
    for (const provider of providers) {
      if (next.has(provider.id)) continue;
      if (!made.has(provider)) made.set(provider, declaredHarness(provider));
      const row = made.get(provider) ?? null;
      if (row !== null) next.set(row.harness, row);
    }
    return next;
  };
  let rows = rowsOf([]);
  const held = new Map(rows);
  const moves = yield* Effect.acquireRelease(PubSub.sliding<void>({ capacity: 1 }), PubSub.shutdown);
  return HarnessAdapters.of({
    declared: (providers) =>
      Effect.suspend(() => {
        const next = rowsOf(providers);
        if (same(rows, next)) return Effect.void;
        rows = next;
        for (const [id, row] of next) held.set(id, row);
        return PubSub.publish(moves, undefined);
      }),
    find: (id) => rows.get(id) ?? null,
    last: (id) => rows.get(id) ?? held.get(id) ?? null,
    row: (id, install) =>
      Effect.suspend(() => {
        const row = rows.get(id);
        return row === undefined ? Effect.fail(harnessNotInstalled(id, install)) : Effect.succeed(row);
      }),
    all: () => [...rows.values()],
    changes: Stream.fromPubSub(moves),
  });
});

export const harnessAdaptersLayer = Layer.effect(HarnessAdapters, makeHarnessAdapters);
