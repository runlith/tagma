import { expect } from 'bun:test';
import { dirname, join } from 'node:path';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { layer } from '@runlith/effect-test';
import { Git, gitLayer } from '@runlith/git/Git';
import { mergeTreeApart } from '@runlith/git/apart';
import { blobsAt } from '@runlith/git/entries';
import { run } from '@runlith/git/repository';
import { Effect, FileSystem, Layer } from 'effect';
import { graphDriver } from './graphMerge.js';

const host = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const git = gitLayer.pipe(Layer.provide(BunChildProcessSpawner.layer.pipe(Layer.provide(host))));
const block = (id: number, body: string, tag = 'note') =>
  `---\nid: 0198c3d4-7b2a-7f00-8000-${id.toString(16).padStart(12, '0')}\ntitle: Block ${id}\nord: 1\ntags: ["${tag}"]\n---\n${body}\n`;
const lines = (first: string, last: string) => [first, 'one', 'two', 'three', 'four', 'five', last].join('\n');

layer(Layer.merge(git, host), { excludeTestServices: true })('graph merge settlement', (it) => {
  it.effect('one driver batch keeps base conflict hunks, independent branch edits and block moves, and names deletions that yielded', () =>
    Effect.gen(function* () {
      const git = yield* Git;
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'graph-settlement-' });
      const command = (args: readonly string[]) => run(git, root, args, undefined);
      const put = (path: string, text: string) =>
        Effect.andThen(files.makeDirectory(dirname(join(root, path)), { recursive: true }), files.writeFileString(join(root, path), text));
      const commit = Effect.fnUntraced(function* (message: string) {
        yield* command(['add', '-A']);
        yield* command(['commit', '-qm', message]);
        return (yield* command(['rev-parse', 'HEAD'])).trim();
      });
      yield* command(['init', '-q', '-b', 'main', '--object-format=sha256']);
      yield* command(['config', 'user.name', 'test']);
      yield* command(['config', 'user.email', 'test@test']);
      yield* put('.git/info/attributes', '/.tagma/**/*.md merge=tagma-graph\n');
      yield* put('.tagma/both.md', block(1, lines('base', 'tail')));
      yield* put('.tagma/moved.md', block(2, 'The old body.'));
      yield* put('.tagma/gone.md', block(3, 'The deleted block.'));
      const base = yield* commit('base');
      yield* put('.tagma/both.md', block(1, lines('ours', 'tail')));
      yield* files.remove(join(root, '.tagma/moved.md'));
      yield* put('.tagma/moved/index.md', block(2, 'The rewritten body on the base branch.'));
      yield* put('.tagma/moved/child.md', block(4, 'The new child.'));
      yield* files.remove(join(root, '.tagma/gone.md'));
      const ours = yield* commit('ours');
      yield* command(['checkout', '-q', '--detach', base]);
      yield* put('.tagma/both.md', block(1, lines('theirs', 'branch tail')));
      yield* put('.tagma/moved.md', block(2, 'The old body.', 'explanation'));
      yield* put('.tagma/gone.md', block(3, 'The branch changed this deleted block.'));
      const theirs = yield* commit('theirs');

      const merged = yield* mergeTreeApart(git, root, ours, theirs, { driver: graphDriver });
      expect(merged.conflicts).toEqual([]);
      expect([...merged.yielded].sort()).toEqual(['.tagma/both.md', '.tagma/gone.md']);
      const paths = ['.tagma/both.md', '.tagma/moved/index.md', '.tagma/moved/child.md', '.tagma/moved.md', '.tagma/gone.md'];
      const read = yield* blobsAt(
        git,
        root,
        paths.map((path) => ({ tree: merged.tree, path })),
      );
      expect(read.map((one) => (one.status === 'text' ? one.text : one.status))).toEqual([
        block(1, lines('ours', 'branch tail')),
        block(2, 'The rewritten body on the base branch.', 'explanation'),
        block(4, 'The new child.'),
        'absent',
        'absent',
      ]);
    }),
  );
});
