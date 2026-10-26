import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, FileSystem } from 'effect';
import { join } from 'node:path';
import { boundServeLog, SERVE_LOG_KEPT } from './serveLogBound.js';

const lines = (count: number, word: string): string => Array.from({ length: count }, (_unused, at) => `${word} ${at}\n`).join('');

layer(BunFileSystem.layer, { excludeTestServices: true })('serve log retention', (it) => {
  it.effect('a log past its cap keeps its tail beside it and is emptied, and the writer holding it open goes on appending', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const home = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-serve-log-' });
      const path = join(home, 'serve.log');
      yield* files.writeFileString(path, `${lines(400, 'old')}${lines(400, 'recent')}`);
      const was = Number((yield* files.stat(path)).size);
      const writer = yield* files.open(path, { flag: 'a' });
      const bound = yield* boundServeLog(path, { cap: 1024, tail: 2048 });
      expect(bound).toMatchObject({ _tag: 'Bound', was });
      expect(Number((yield* files.stat(path)).size)).toBe(0);
      yield* writer.writeAll(new TextEncoder().encode('after the bound\n'));
      expect(yield* files.readFileString(path)).toBe('after the bound\n');
      const kept = yield* files.readFileString(`${path}${SERVE_LOG_KEPT}`);
      expect(kept.endsWith('recent 399\n')).toBe(true);
      expect(kept.startsWith('recent ')).toBe(true);
      expect(kept).not.toContain('old 0\n');
    }),
  );

  it.effect('a log under its cap is not touched, and a file that is not there is not an error', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const home = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-serve-log-' });
      const path = join(home, 'small.log');
      const held = lines(10, 'line');
      yield* files.writeFileString(path, held);
      expect(yield* boundServeLog(path, { cap: 1024 * 1024, tail: 1024 })).toEqual({ _tag: 'Kept', bytes: held.length });
      expect(yield* files.readFileString(path)).toBe(held);
      expect(yield* boundServeLog(join(home, 'nothing.log'), { cap: 1, tail: 1 })).toEqual({ _tag: 'Absent' });
    }),
  );
});
