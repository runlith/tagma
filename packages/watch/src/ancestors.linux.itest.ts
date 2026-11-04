import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect } from 'effect';
import { makeWatchClient } from './client.js';
import { changesUntil, hearing, naming, TREE, world } from './testing/hearing.js';

it.live('a root under two adjacent unreadable ancestors is refused naming both, and the same root is watched once they are readable', () =>
  Effect.gen(function* () {
    const { tree, place } = yield* world('watch-ancestors-');
    const outer = join(tree, 'outer');
    const inner = join(outer, 'inner');
    const root = join(inner, 'below', 'root');
    yield* Effect.promise(() => mkdir(root, { recursive: true }));
    const restore = Effect.promise(async () => {
      await chmod(outer, 0o700);
      await chmod(inner, 0o700);
    });
    yield* Effect.addFinalizer(() => restore);
    yield* Effect.promise(async () => {
      await chmod(inner, 0o300);
      await chmod(outer, 0o300);
    });
    const client = yield* makeWatchClient({ dir: place, lifetime: 'with-client' });
    const refusal = yield* Effect.flip(client.subscribe(root, TREE, (yield* hearing).into));
    yield* restore;
    const heard = yield* hearing;
    yield* client.subscribe(root, TREE, heard.into);
    yield* Effect.promise(() => writeFile(join(root, 'after'), ''));
    yield* changesUntil(heard.heard, naming('after'));
    expect({ refused: refusal._tag, named: [outer, inner].map((path) => refusal.message.includes(path)) }).toEqual({
      refused: 'WatchRefused',
      named: [true, true],
    });
  }),
);
