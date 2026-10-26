import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Queue } from 'effect';
import { makeWatchClient, type WatchHearing } from './client.js';
import type { WatchChange } from './protocol.js';

type Heard = { readonly changes: readonly WatchChange[] } | { readonly ended: string } | { readonly dropped: string };

const home = Effect.acquireRelease(
  Effect.promise(async () => realpath(await mkdtemp(join(tmpdir(), 'watch-')))),
  (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
);

const hearing = Effect.map(Queue.unbounded<Heard>(), (heard) => {
  const into: WatchHearing = {
    heard: (changes) => Queue.offerUnsafe(heard, { changes }),
    dropped: (reason) => Queue.offerUnsafe(heard, { dropped: reason }),
    ended: (reason) => Queue.offerUnsafe(heard, { ended: reason }),
  };
  return { heard, into };
});

const pathsUntil = Effect.fnUntraced(function* (heard: Queue.Queue<Heard>, wanted: string) {
  const seen: string[] = [];
  while (!seen.includes(wanted)) {
    const one = yield* Queue.take(heard);
    if ('changes' in one) seen.push(...one.changes.map((change) => change.path));
    else return yield* Effect.die(`the subscription ended before ${wanted}: ${JSON.stringify(one)}`);
  }
  return seen;
});

const world = Effect.fnUntraced(function* () {
  const dir = yield* home;
  const tree = join(dir, 'tree');
  yield* Effect.promise(() => mkdir(tree));
  return { dir, tree, place: join(dir, 'place') };
});

const TREE = { recursive: true, ignore: [] } as const;

it.live('clients starting one channel share one process, with relative filtered events and a flat view hearing only its own entries', () =>
  Effect.gen(function* () {
    const { tree, place } = yield* world();
    yield* Effect.promise(() => mkdir(join(tree, 'kept', 'deep'), { recursive: true }));
    yield* Effect.promise(() => mkdir(join(tree, 'ignored'), { recursive: true }));
    const [first, second] = yield* Effect.all(
      [makeWatchClient({ dir: place, lifetime: 'with-client' }), makeWatchClient({ dir: place, lifetime: 'with-client' })],
      { concurrency: 2 },
    );
    const deep = yield* hearing;
    const flat = yield* hearing;
    const beyondNative = Array.from({ length: 8 }, (_, at) => `absent-${at}`);
    yield* Effect.all(
      [
        first.subscribe(tree, { recursive: true, ignore: [...beyondNative, 'ignored'] }, deep.into),
        second.subscribe(tree, { recursive: false, ignore: [] }, flat.into),
      ],
      { concurrency: 2 },
    );
    expect(Bun.spawnSync(['pgrep', '-f', place]).stdout.toString().trim().split('\n').filter(Boolean)).toHaveLength(1);
    yield* Effect.promise(async () => {
      await writeFile(join(tree, 'ignored', 'skip'), 'x');
      await writeFile(join(tree, 'kept', 'deep', 'file'), 'x');
      await writeFile(join(tree, 'top'), 'x');
    });
    const named = yield* pathsUntil(deep.heard, 'top');
    const shallow = yield* pathsUntil(flat.heard, 'top');
    expect({
      deep: named.includes('kept/deep/file'),
      ignored: named.some((path) => path.startsWith('ignored')),
      nested: shallow.some((path) => path.includes('/')),
    }).toEqual({ deep: true, ignored: false, nested: false });
  }),
);

it.live('a lost watch process ends every open subscription, and the next subscription starts a new process', () =>
  Effect.gen(function* () {
    const { tree, place } = yield* world();
    const client = yield* makeWatchClient({ dir: place, lifetime: 'with-client' });
    const first = yield* hearing;
    yield* client.subscribe(tree, TREE, first.into);
    yield* Effect.promise(async () => {
      if (Bun.spawnSync(['pkill', '-KILL', '-f', place]).exitCode !== 0) throw new Error('no watch process to kill');
    });
    expect(yield* Queue.take(first.heard)).toMatchObject({ ended: expect.any(String) });
    const second = yield* hearing;
    yield* client.subscribe(tree, TREE, second.into);
    yield* Effect.promise(() => writeFile(join(tree, 'after'), 'x'));
    expect(yield* pathsUntil(second.heard, 'after')).toContain('after');
  }),
);

it.live('a detached process keeps what changed while no client was connected, and answers it to the next one from its own record', () =>
  Effect.gen(function* () {
    const { dir, tree, place } = yield* world();
    const snapshot = join(dir, 'mark');
    const position = yield* Effect.scoped(
      Effect.gen(function* () {
        const before = yield* makeWatchClient({ dir: place, lifetime: 'detached' });
        const opened = yield* hearing;
        const subscription = yield* before.subscribe(tree, TREE, opened.into);
        const marked = yield* before.mark(tree, snapshot, [], true);
        yield* subscription.leave;
        return marked;
      }),
    );
    yield* Effect.promise(async () => {
      await rm(snapshot, { force: true });
      await writeFile(join(tree, 'while-away'), 'x');
    });
    const after = yield* makeWatchClient({ dir: place, lifetime: 'detached' });
    yield* Effect.addFinalizer(() => after.shutdown);
    let changed = yield* after.changedSince(tree, position, []);
    while (changed !== null && changed.length === 0) {
      yield* Effect.sleep('20 millis');
      changed = yield* after.changedSince(tree, position, []);
    }
    expect(changed?.map((change) => change.path)).toEqual(['while-away']);
  }),
);

it.live(
  'a root that changed more paths than the process keeps answers no list, and a replaced process still answers from the snapshot',
  () =>
    Effect.gen(function* () {
      const { dir, tree, place } = yield* world();
      const snapshot = join(dir, 'mark');
      const small = yield* makeWatchClient({ dir: place, lifetime: 'with-client', retain: 2 });
      const opened = yield* hearing;
      yield* small.subscribe(tree, TREE, opened.into);
      const position = yield* small.mark(tree, snapshot, [], true);
      yield* Effect.promise(async () => {
        for (const name of ['a', 'b', 'c']) await writeFile(join(tree, name), 'x');
      });
      yield* pathsUntil(opened.heard, 'c');
      yield* Effect.promise(() => rename(snapshot, `${snapshot}.aside`));
      const overflowed = yield* small.changedSince(tree, position, []);
      yield* Effect.promise(() => rename(`${snapshot}.aside`, snapshot));
      yield* small.shutdown;
      const replaced = yield* makeWatchClient({ dir: join(dir, 'next'), lifetime: 'with-client' });
      yield* replaced.changedSince(tree, position, []);
      yield* Effect.promise(() => writeFile(join(tree, 'during'), 'x'));
      const fromSnapshot = ((yield* replaced.changedSince(tree, position, [])) ?? []).map((change) => change.path);
      expect({ overflowed, fromSnapshot: ['a', 'b', 'c', 'during'].filter((name) => !fromSnapshot.includes(name)) }).toEqual({
        overflowed: null,
        fromSnapshot: [],
      });
    }),
);
