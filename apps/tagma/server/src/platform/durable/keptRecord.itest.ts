import { expect } from 'bun:test';
import { join } from 'node:path';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, FileSystem, Schema } from 'effect';
import { makeKeptRecord } from './keptRecord.js';

const shape = Schema.Struct({ step: Schema.Int });

layer(BunFileSystem.layer, { excludeTestServices: true })('kept record', (it) => {
  it.effect('writes made at once all land and the last one stands', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-kept-' });
      const record = yield* makeKeptRecord(shape, join(root, 'nested', 'record.json'), 'test record');

      yield* Effect.forEach([1, 2, 3, 4, 5, 6], (step) => record.write({ step }), { concurrency: 'unbounded', discard: true });

      expect(yield* record.read).toEqual({ step: 6 });
    }),
  );

  it.effect('a record that does not read is set aside and reads as none', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-kept-' });
      const at = join(root, 'record.json');
      yield* files.writeFileString(at, '{"step":"one"}');
      const record = yield* makeKeptRecord(shape, at, 'test record');

      expect(yield* record.read).toBeNull();
      expect(yield* files.exists(at)).toBe(false);
      expect(yield* files.readFileString(`${at}.unread`)).toBe('{"step":"one"}');
    }),
  );
});
