import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, FileSystem, Layer } from 'effect';
import type { Git } from '@runlith/git/Git';
import { holdingsOver } from '../../change-record/testing/holdings.js';
import type { Walks } from '../../change-record/lines/walks.js';
import { RootId } from '../../workspace/contract/wire/ids.js';
import { TEST_CHECKOUT } from '../../workspace/testing/doubles.js';
import { FILE, checkoutFixture, withCheckout, type CheckoutWorld } from './checkoutFixture.js';
import { CommandWalks, commandWalksLayer } from './change-record/commandWorld.js';
import { lineWrites } from '../lineWrites.js';

const CHECKOUT = RootId.make(TEST_CHECKOUT);

export const retirementCheckout = Effect.fnUntraced(function* (w: CheckoutWorld, walks: Walks, git: Git['Service'] = w.git) {
  const files = yield* FileSystem.FileSystem;
  const rig = yield* holdingsOver(w.store, w.units, git, w.root, walks, undefined, lineWrites);
  const pass = () => rig.retirement.pass(CHECKOUT);
  const commit = Effect.fnUntraced(function* (message: string, ...paths: string[]) {
    for (const path of paths) yield* w.run(['add', '--', path]);
    yield* w.run(['-c', 'user.name=h', '-c', 'user.email=h@h', 'commit', '-q', '-m', message, '--', ...paths]);
    return yield* w.run(['rev-parse', 'HEAD']);
  });
  const aside = Effect.fnUntraced(function* (name: string) {
    yield* files.writeFileString(join(w.root, name), `${name}\n`);
    return yield* commit(`aside ${name}`, name);
  });
  const rowsOf = (threadId: string) =>
    Effect.map(w.rows(), (rows) =>
      rows.filter((row) => row.holder === threadId).map((row) => ({ state: row.state, commit: row.commit, reason: row.reason })),
    );
  return { w, rig, pass, commit, aside, rowsOf };
});

export type RetirementCheckout = Effect.Success<ReturnType<typeof retirementCheckout>>;

export const retirementFixture = Layer.mergeAll(checkoutFixture, commandWalksLayer, BunFileSystem.layer);

export const withRetirement = Effect.fnUntraced(function* <A, E, R>(
  body: (state: RetirementCheckout) => Effect.Effect<A, E, R>,
  git?: (world: CheckoutWorld) => Git['Service'],
) {
  const walks = yield* CommandWalks;
  return yield* withCheckout((world) => Effect.flatMap(retirementCheckout(world, walks, git?.(world)), body));
});

export const lines = (...changed: readonly [number, string][]): string[] => {
  const next = [...FILE];
  for (const [at, text] of changed) next[at] = text;
  return next;
};
