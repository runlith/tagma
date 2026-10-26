import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { accessSync, constants, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Queue } from 'effect';
import { makeWatchClient } from './client.js';
import { changesUntil, hearing, naming, TREE, world as worldAt } from './testing/hearing.js';

const WATCHES = '/proc/sys/fs/inotify/max_user_watches';
const QUEUED = '/proc/sys/fs/inotify/max_queued_events';
const INSTANCES = '/proc/sys/fs/inotify/max_user_instances';

const tunable = (() => {
  if (process.platform !== 'linux') return false;
  try {
    accessSync(WATCHES, constants.W_OK);
    return true;
  } catch {
    return false;
  }
})();

const inotifyIt = tunable ? it.live : it.live.skip;

const world = () => worldAt('watch-limits-');

const lowered = (knob: string, value: number) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const before = readFileSync(knob, 'utf8').trim();
      writeFileSync(knob, String(value));
      return before;
    }),
    (before) => Effect.sync(() => writeFileSync(knob, before)),
  );

inotifyIt('a tree past the inotify watch limit is refused with the limit named, and the watch process serves the next tree', () =>
  Effect.gen(function* () {
    const { dir, tree, place } = yield* world();
    yield* Effect.promise(() => Promise.all(Array.from({ length: 200 }, (_, at) => mkdir(join(tree, `dir-${at}`)))));
    const client = yield* makeWatchClient({ dir: place, lifetime: 'with-client' });
    const refusal = yield* Effect.scoped(
      Effect.gen(function* () {
        yield* lowered(WATCHES, 50);
        return yield* Effect.flip(client.subscribe(tree, TREE, (yield* hearing).into));
      }),
    );
    const small = join(dir, 'small');
    yield* Effect.promise(() => mkdir(small));
    const next = yield* hearing;
    yield* client.subscribe(small, TREE, next.into);
    yield* Effect.promise(() => writeFile(join(small, 'after'), ''));
    yield* changesUntil(next.heard, naming('after'));
    expect({ refused: refusal._tag, named: refusal.message.includes('max_user_watches') }).toEqual({
      refused: 'WatchRefused',
      named: true,
    });
  }),
);

inotifyIt('a directory made after the watch limit is reached ends its watch with the limit named', () =>
  Effect.gen(function* () {
    const { tree, place } = yield* world();
    const client = yield* makeWatchClient({ dir: place, lifetime: 'with-client' });
    const deep = yield* hearing;
    yield* client.subscribe(tree, TREE, deep.into);
    yield* lowered(WATCHES, 1);
    yield* Effect.promise(() => mkdir(join(tree, 'late')));
    let ended: string | null = null;
    while (ended === null) {
      const one = yield* Queue.take(deep.heard);
      if ('ended' in one) ended = one.ended;
    }
    expect(ended.includes('max_user_watches')).toBe(true);
  }),
);

inotifyIt('an exhausted inotify instance limit refuses a subscription with the limit named, and a later one opens once it is lifted', () =>
  Effect.gen(function* () {
    const { tree, place } = yield* world();
    const client = yield* makeWatchClient({ dir: place, lifetime: 'with-client' });
    const refusal = yield* Effect.scoped(
      Effect.gen(function* () {
        yield* lowered(INSTANCES, 0);
        return yield* Effect.flip(client.subscribe(tree, TREE, (yield* hearing).into));
      }),
    );
    const deep = yield* hearing;
    yield* client.subscribe(tree, TREE, deep.into);
    yield* Effect.promise(() => writeFile(join(tree, 'after'), ''));
    yield* changesUntil(deep.heard, naming('after'));
    expect({ refused: refusal._tag, named: refusal.message.includes('max_user_instances') }).toEqual({
      refused: 'WatchRefused',
      named: true,
    });
  }),
);

inotifyIt(
  'an overflowed inotify queue is told as a drop of the whole root, and later writes are heard again, also in directories made while it overflowed',
  () =>
    Effect.gen(function* () {
      const { tree, place } = yield* world();
      yield* lowered(QUEUED, 16);
      const client = yield* makeWatchClient({ dir: place, lifetime: 'with-client' });
      const deep = yield* hearing;
      yield* client.subscribe(tree, TREE, deep.into);
      yield* Effect.promise(async () => {
        await Promise.all(Array.from({ length: 300 }, (_, at) => writeFile(join(tree, String(at)), '')));
        await mkdir(join(tree, 'unseen', 'deeper'), { recursive: true });
        await Promise.all(Array.from({ length: 300 }, (_, at) => writeFile(join(tree, `again-${at}`), '')));
      });
      let dropped: string | null | undefined;
      while (dropped === undefined) {
        const one = yield* Queue.take(deep.heard);
        if ('ended' in one) return yield* Effect.die(`the subscription ended: ${one.ended}`);
        if ('dropped' in one) dropped = one.dropped;
      }
      yield* Effect.promise(() => writeFile(join(tree, 'unseen', 'deeper', 'after'), ''));
      let after = false;
      while (!after) {
        const one = yield* Queue.take(deep.heard);
        if ('ended' in one) return yield* Effect.die(`the subscription ended: ${one.ended}`);
        if ('changes' in one) after = one.changes.some((change) => change.path === 'unseen/deeper/after');
      }
      expect(dropped).toBeNull();
    }),
);
