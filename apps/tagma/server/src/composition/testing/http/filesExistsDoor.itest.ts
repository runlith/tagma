import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { join } from 'node:path';
import { doorFixture, DoorFixture } from '../doorFixture.js';

const projectWith = Effect.fnUntraced(function* (files: Record<string, string>) {
  const world = yield* DoorFixture;
  const fs = yield* FileSystem.FileSystem;
  const root = yield* world.directory('files-exists');
  for (const [name, content] of Object.entries(files)) {
    const file = join(root, name);
    yield* fs.makeDirectory(join(file, '..'), { recursive: true });
    yield* fs.writeFileString(file, content);
  }
  yield* world.stealthProject(root);
  return root;
});

const exists = (root: string, path: string) =>
  Effect.flatMap(DoorFixture, (world) => world.op('read_path_exists', { path }, `cwd=${encodeURIComponent(root)}`));

class FilesRoot extends Context.Service<FilesRoot, string>()('testing/FilesRoot') {}
const fixture = Layer.effect(
  FilesRoot,
  projectWith({
    'src/x.ts': 'export const x = 1;\n',
    'sub/nested.ts': 'export const y = 2;\n',
    'hello.txt': 'hello\n',
    'closed/inside.ts': 'export const x = 1;\n',
  }),
).pipe(Layer.provideMerge(Layer.merge(doorFixture(), BunFileSystem.layer)));

layer(fixture, { excludeTestServices: true })('path existence door', (it) => {
  it.effect('what stands in the served tree answers true, files and directories alike', () =>
    Effect.gen(function* () {
      const root = yield* FilesRoot;

      for (const path of ['src/x.ts', 'sub/nested.ts', 'sub']) {
        const answer = yield* exists(root, path);
        expect(answer.status).toBe(200);
        expect(answer.body).toMatchObject({ status: 'ok', exists: true });
      }

      const missing = yield* exists(root, 'src/absent.ts');
      expect(missing.status).toBe(200);
      expect(missing.body).toMatchObject({ status: 'ok', exists: false });
    }),
  );

  it.effect('an absolute path inside the tree answers, one outside is refused', () =>
    Effect.gen(function* () {
      const root = yield* FilesRoot;
      const world = yield* DoorFixture;
      const fs = yield* FileSystem.FileSystem;
      const alias = join(yield* world.directory('files-alias'), 'checkout');
      yield* fs.symlink(root, alias);

      for (const path of [join(root, 'hello.txt'), join(alias, 'hello.txt')]) {
        const inside = yield* exists(root, path);
        expect(inside.status).toBe(200);
        expect(inside.body).toMatchObject({ status: 'ok', exists: true });
      }
      const missing = yield* exists(root, join(alias, 'missing', 'file.txt'));
      expect(missing.status).toBe(200);
      expect(missing.body).toMatchObject({ status: 'ok', exists: false });

      const outside = yield* exists(root, '/etc/hostname');
      expect(outside.status).toBe(409);
      expect(outside.body).toMatchObject({ code: 'path-outside-tree' });
      expect((outside.body as { unblock: string[] }).unblock.length).toBeGreaterThan(0);
    }),
  );

  it.effect('a traversal past the root is refused, never probed', () =>
    Effect.gen(function* () {
      const root = yield* FilesRoot;

      for (const path of ['../outside.txt', 'sub/../../outside.txt', '..']) {
        const refused = yield* exists(root, path);
        expect(refused.status).toBe(409);
        expect(refused.body).toMatchObject({ code: 'path-outside-tree' });
      }
    }),
  );

  it.effect('a path the read could not reach refuses, and is never answered as missing', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* FilesRoot;
      const closed = join(root, 'closed');
      yield* Effect.acquireRelease(fs.chmod(closed, 0o000), () => Effect.orDie(fs.chmod(closed, 0o755)));
      const answer = yield* exists(root, 'closed/inside.ts');
      expect(answer.status).toBe(409);
      expect(answer.body).toMatchObject({ code: 'files' });
    }),
  );

  it.effect('a symlink spelling an outside path is refused, however lexical it reads', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* FilesRoot;
      yield* fs.symlink('/etc', join(root, 'link'));

      const refused = yield* exists(root, 'link/hostname');
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ code: 'path-outside-tree' });
    }),
  );
});
