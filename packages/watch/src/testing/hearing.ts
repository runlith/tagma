import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Queue } from 'effect';
import type { WatchHearing } from '../client.js';
import type { WatchChange } from '../protocol.js';

export type Heard = { readonly changes: readonly WatchChange[] } | { readonly ended: string } | { readonly dropped: string | null };

export const TREE = { recursive: true, ignore: [] } as const;

export const world = Effect.fnUntraced(function* (prefix: string) {
  const dir = yield* Effect.acquireRelease(
    Effect.promise(async () => realpath(await mkdtemp(join(tmpdir(), prefix)))),
    (made) => Effect.promise(() => rm(made, { recursive: true, force: true })),
  );
  const tree = join(dir, 'tree');
  yield* Effect.promise(() => mkdir(tree));
  return { dir, tree, place: join(dir, 'place') };
});

export const hearing = Effect.map(Queue.unbounded<Heard>(), (heard) => {
  const into: WatchHearing = {
    heard: (changes) => Queue.offerUnsafe(heard, { changes }),
    dropped: (_reason, subtree) => Queue.offerUnsafe(heard, { dropped: subtree }),
    ended: (reason) => Queue.offerUnsafe(heard, { ended: reason }),
  };
  return { heard, into };
});

export const changesUntil = Effect.fnUntraced(function* (heard: Queue.Queue<Heard>, done: (seen: readonly WatchChange[]) => boolean) {
  const seen: WatchChange[] = [];
  while (!done(seen)) {
    const one = yield* Queue.take(heard);
    if ('changes' in one) seen.push(...one.changes);
    else return yield* Effect.die(`the subscription said ${JSON.stringify(one)} before it named what was awaited`);
  }
  return seen;
});

export const naming = (path: string) => (seen: readonly WatchChange[]) => seen.some((change) => change.path === path);

export const lastOf = (seen: readonly WatchChange[], path: string) => seen.findLast((change) => change.path === path)?.kind;
