import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { grantSignerAt } from './grants.js';

layer(BunFileSystem.layer, { excludeTestServices: true })('installation grants', (it) => {
  it.effect('a reopened installation accepts its existing grant, another installation and a changed identity do not', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-grants-' });
      const path = join(root, 'first.key');
      const first = yield* grantSignerAt(path);
      const grant = first.grantFor('owned-session');
      const reopened = yield* grantSignerAt(path);
      const other = yield* grantSignerAt(join(root, 'second.key'));
      expect(reopened.threadOf(grant)).toBe('owned-session');
      expect(other.threadOf(grant)).toBeNull();
      expect(reopened.threadOf(grant.replace('owned-session', 'other-session'))).toBeNull();
      expect((yield* files.stat(path)).mode & 0o777).toBe(0o600);
    }),
  );

  it.effect('an unreadable or damaged key fails initialization without replacing its bytes', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-grants-' });
      const path = join(root, 'damaged.key');
      yield* files.writeFileString(path, 'damaged');
      expect((yield* Effect.flip(grantSignerAt(path)))._tag).toBe('GrantKeyInvalid');
      expect(yield* files.readFileString(path)).toBe('damaged');
      expect((yield* Effect.flip(grantSignerAt(root)))._tag).toBe('PlatformError');
    }),
  );
});
