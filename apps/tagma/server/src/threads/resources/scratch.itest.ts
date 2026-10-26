import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { makeThreadScratch } from './scratch.js';

layer(BunFileSystem.layer, { excludeTestServices: true })('thread scratch', (it) => {
  it.effect('a scope resolves paths within its own thread and refuses an id escaping that directory', () =>
    Effect.gen(function* () {
      const scratch = yield* makeThreadScratch({ root: '/scratch' });
      expect(scratch.directory('one')).toBe('/scratch/one');
      expect(scratch.directory('two')).toBe('/scratch/two');
      expect(() => scratch.directory('../elsewhere')).toThrow('cannot name a scratch directory');
      const scope = scratch.scope('one');
      expect(scope.resolve('spec/one.md')).toBe(join(scope.path, 'spec/one.md'));
      expect(scope.resolve('/etc/hosts')).toBe('/etc/hosts');
    }),
  );

  it.effect('ensure preserves files and releasing one thread leaves its neighbour intact', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'thread-scratch-' });
      const scratch = yield* makeThreadScratch({ root });
      const path = yield* scratch.ensure('one');
      yield* files.writeFileString(join(path, 'document.json'), '{"ops":[]}');
      expect(yield* scratch.ensure('one')).toBe(path);
      expect(yield* files.readFileString(join(path, 'document.json'))).toBe('{"ops":[]}');
      const neighbour = yield* scratch.ensure('two');
      yield* files.writeFileString(join(neighbour, 'body.md'), 'the neighbour');
      yield* scratch.release('one');
      expect(yield* files.exists(path)).toBe(false);
      expect(yield* files.readFileString(join(neighbour, 'body.md'))).toBe('the neighbour');
      yield* scratch.release('never-opened');
      expect(yield* files.exists(scratch.directory('never-opened'))).toBe(false);
    }),
  );
});
