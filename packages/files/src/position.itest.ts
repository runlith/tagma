import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, FileSystem } from 'effect';

layer(BunFileSystem.layer, { excludeTestServices: true })('file positions', (it) => {
  for (const operation of ['write', 'writeAll'] as const) {
    it.effect(`${operation} writes at the sought byte without overwriting the prefix`, () =>
      Effect.gen(function* () {
        const files = yield* FileSystem.FileSystem;
        const path = yield* files.makeTempFileScoped({ prefix: 'file-position-' });
        yield* files.writeFileString(path, 'abcdefgh');
        const file = yield* files.open(path, { flag: 'r+' });
        yield* file.seek(8n, 'start');
        yield* file[operation](new TextEncoder().encode('XY'));
        expect(yield* files.readFileString(path)).toBe('abcdefghXY');
      }),
    );
  }
});
