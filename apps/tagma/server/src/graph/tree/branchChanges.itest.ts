import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Git, gitLayer } from '@runlith/git/Git';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { Effect, FileSystem, Layer } from 'effect';
import { gitIdentity, ownGitLayer, runGit } from '../../platform/git/ownGit.js';
import type { Tag } from '../contract/wire/tags/declaration.js';
import { TagIndex } from '../vocabulary/tagIndex.js';
import { graphChangesAt } from './branchChanges.js';
import { GRAPH_BEHAVIOURS } from '../testing/behaviours.js';

const platform = Layer.merge(BunFileSystem.layer, BunPath.layer);
const spawning = BunChildProcessSpawner.layer.pipe(Layer.provide(platform));
const git = ownGitLayer(gitLayer.pipe(Layer.provide(spawning)));

const declared = (id: string, roles: Tag['roles'], fields: Tag['fields'] = {}, gates: Tag['gates'] = []): Tag => ({
  id,
  fields,
  edges: [],
  gates,
  roles,
  body: { shape: 'content' },
  prompt: '',
});

const table = new TagIndex(
  [
    declared('memo', {}),
    declared(
      'errand',
      { status: { field: 'state', initial: 'open', done: 'shipped', closed: 'dropped' } },
      { state: { type: 'enum', values: ['open', 'review', 'shipped', 'dropped'] } },
      [
        { gate: 'transition', field: 'state', from: 'open', to: 'review' },
        { gate: 'transition', field: 'state', from: 'review', to: 'shipped' },
        { gate: 'transition', field: 'state', from: 'review', to: 'dropped' },
      ],
    ),
  ],
  GRAPH_BEHAVIOURS,
);

const block = (id: number, tags: readonly string[], fields: Record<string, string> = {}): string => {
  const uuid = `01a0d000-0000-7000-8000-${String(id).padStart(12, '0')}`;
  return `---\nid: ${uuid}\ntitle: ${uuid}\nord: 1\ntags: ${JSON.stringify(tags)}\nfields: ${JSON.stringify(fields)}\n---\nbody\n`;
};

layer(Layer.merge(platform, git), { excludeTestServices: true })('branch graph changes', (it) => {
  it.effect('counts status transitions by their owning tag and keeps unreadable files visible', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: 'graph-changes-' });
      const dir = join(root, '.tagma', 'p');
      yield* fs.makeDirectory(dir, { recursive: true });
      const git = yield* Git;
      const run = (...args: string[]) => runGit(git, 'branch-changes-setup', ['-C', root, ...args], { env: gitIdentity('test') });
      const put = (name: string, text: string) => fs.writeFileString(join(dir, `${name}.md`), text);
      yield* run('init', '-q', '-b', 'main');
      const kept = block(1, ['memo']);
      const shipped = block(3, ['memo', 'errand'], { state: 'review' });
      const dropped = block(4, ['errand'], { state: 'open' });
      const worded = block(5, ['errand'], { state: 'open', status: 'done' });
      yield* put('kept', kept);
      yield* put('gone', block(2, ['memo']));
      yield* put('shipped', shipped);
      yield* put('dropped', dropped);
      yield* put('worded', worded);
      yield* run('add', '-A');
      yield* run('commit', '-q', '-m', 'base');
      yield* run('switch', '-q', '-c', 'side');
      yield* put('kept', `${kept}more\n`);
      yield* fs.remove(join(dir, 'gone.md'));
      yield* put('shipped', shipped.replace('"review"', '"shipped"'));
      yield* put('dropped', dropped.replace('"open"', '"dropped"'));
      yield* put('worded', worded.replace('"status":"done"', '"status":"closed"'));
      yield* put('new', block(6, ['memo']));
      yield* put('broken', 'no fence\n');
      yield* run('add', '-A');
      yield* run('commit', '-q', '-m', 'side');
      yield* run('switch', '-q', 'main');
      yield* fs.writeFileString(join(root, 'code.ts'), 'export {};\n');
      yield* run('add', '-A');
      yield* run('commit', '-q', '-m', 'main moved');

      expect(yield* graphChangesAt(git, root, 'refs/heads/main', 'refs/heads/side', '.tagma', table)).toEqual({
        status: 'counted',
        kinds: [
          { tag: 'errand', added: 0, changed: 1, removed: 0, done: 1, closed: 1, doneWord: 'shipped', closedWord: 'dropped' },
          { tag: 'memo', added: 1, changed: 1, removed: 1, done: 0, closed: 0, doneWord: null, closedWord: null },
        ],
        files: 7,
        unsorted: 0,
        unreadable: [{ path: '.tagma/p/broken.md', reason: expect.any(String) }],
      });
    }),
  );
});
