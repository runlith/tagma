import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Clock, Effect } from 'effect';
import { makeDigests } from './digests.js';

it.live('a file rewritten with the same size and modification time is hashed again while that time is recent', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), 'plugin-digests-')));
      const manifest = join(root, 'tagma-plugin.json');
      const { digest } = yield* makeDigests;
      const tick = Math.floor((yield* Clock.currentTimeMillis) / 1000);
      const written = (text: string) =>
        Effect.promise(async () => {
          await writeFile(manifest, text);
          await utimes(manifest, tick, tick);
        });
      yield* written('{"build":"aaaa"}');
      const first = yield* digest(root, ['tagma-plugin.json'], 'outputs');
      yield* written('{"build":"bbbb"}');
      expect(yield* digest(root, ['tagma-plugin.json'], 'outputs')).not.toBe(first);
    }),
  ),
);
