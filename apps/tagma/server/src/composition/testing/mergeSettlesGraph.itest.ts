import { expect } from 'bun:test';
import { dirname, join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Effect, FileSystem, Layer } from 'effect';
import { demoGraphLayer, withDemo } from './graphFixture.js';
import { composed, shEffect } from './finishingFixture.js';
import { makeMachineWorld } from '../../executions/testing/doubles.js';
import { readBlockTree } from '../../graph/tree/layout.js';

const ROOT = '01a14a44-0000-7000-8000-000000000000';
const MOVED = '01a14a44-0000-7000-8000-000000000001';
const CHILD = '01a14a44-0000-7000-8000-000000000002';
const GONE = '01a14a44-0000-7000-8000-000000000003';
const BOTH = '01a14a44-0000-7000-8000-000000000004';
const CATALOG = '01a14a44-0000-7000-8000-000000000005';
const RENAMED = '01a14a44-0000-7000-8000-000000000006';

const lines = (contested: string) =>
  ['A block whose file the branch renames,', 'keeping most of its body,', contested, 'so git pairs the rename.'].join('\n');

const block = (id: string, tag: string, body: string) =>
  `---\nid: ${id}\ntitle: Block ${id.slice(-1)}\nord: 1\ntags: ["${tag}"]\n---\n${body}\n`;

const FIRST =
  'What the moved block said before it took a child: a sentence long enough that the block is mostly its body, as a real explanation is.';
const REWRITTEN =
  'What main wrote when the block took its child: another sentence of the same length, so git sees a deletion and an addition, not a rename.';

layer(Layer.merge(demoGraphLayer(), BunFileSystem.layer), { excludeTestServices: true, testTimeout: 30_000, timeout: 60_000 })(
  'worktree merge over graph files',
  (it) => {
    it.effect(
      'graph files both sides changed merge in one act into a graph that reads: a moved or renamed block takes both changes, what both rewrote or main deleted keeps main and is named',
      () =>
        withDemo((demo) =>
          Effect.gen(function* () {
            const files = yield* FileSystem.FileSystem;
            const put = (dir: string, path: string, text: string) =>
              Effect.andThen(
                files.makeDirectory(dirname(join(dir, path)), { recursive: true }),
                files.writeFileString(join(dir, path), text),
              );
            const committed = (dir: string, message: string) =>
              Effect.andThen(shEffect(dir, ['add', '-A']), shEffect(dir, ['commit', '-q', '-m', message]));
            const { finishing, make, project, projectId } = yield* composed(
              demo,
              makeMachineWorld(() => null),
              { carried: true },
            );
            yield* files.writeFileString(join(project, '.git', 'info', 'attributes'), '/.tagma/**/*.md merge=tagma-graph\n');
            yield* put(project, '.tagma/settle/index.md', block(ROOT, 'note', 'The root every block here stands under.'));
            yield* put(project, '.tagma/settle/moved.md', block(MOVED, 'note', FIRST));
            yield* put(project, '.tagma/settle/gone.md', block(GONE, 'note', 'A block main will delete.'));
            yield* put(project, '.tagma/settle/both.md', block(BOTH, 'note', 'The words both sides rewrite.'));
            yield* put(project, '.tagma/settle/catalog.md', block(CATALOG, 'note', 'The catalog as it stood.'));
            yield* put(project, '.tagma/settle/old.md', block(RENAMED, 'note', lines('while both sides rewrite this line.')));
            yield* committed(project, 'the graph both sides start from');
            const side = yield* make('settle');

            yield* put(side.path, '.tagma/settle/moved.md', block(MOVED, 'explanation', FIRST));
            yield* put(side.path, '.tagma/settle/gone.md', block(GONE, 'explanation', 'A block main will delete.'));
            yield* put(side.path, '.tagma/settle/both.md', block(BOTH, 'note', 'The words as the branch rewrote them.'));
            yield* files.remove(join(side.path, '.tagma/settle/catalog.md'));
            yield* put(side.path, '.tagma/settle/catalog-new.md', block(CATALOG, 'explanation', 'The catalog as the branch renamed it.'));
            yield* files.remove(join(side.path, '.tagma/settle/old.md'));
            yield* put(side.path, '.tagma/settle/renamed.md', block(RENAMED, 'note', lines('as the branch rewrote this line.')));
            yield* committed(side.path, 'the branch retags, rewrites and renames');
            yield* files.remove(join(project, '.tagma/settle/moved.md'));
            yield* files.remove(join(project, '.tagma/settle/gone.md'));
            yield* files.remove(join(project, '.tagma/settle/catalog.md'));
            yield* put(project, '.tagma/settle/moved/index.md', block(MOVED, 'note', REWRITTEN));
            yield* put(project, '.tagma/settle/moved/child.md', block(CHILD, 'note', 'The child main gave it.'));
            yield* put(project, '.tagma/settle/both.md', block(BOTH, 'note', 'The words as main rewrote them.'));
            yield* put(project, '.tagma/settle/catalog-new.md', block(CATALOG, 'note', 'The catalog as main renamed it.'));
            yield* put(project, '.tagma/settle/old.md', block(RENAMED, 'note', lines('as main rewrote this line.')));
            yield* committed(project, 'main moves, deletes, rewrites and renames');

            const merged = yield* finishing.merge(projectId, side.rootId, {});

            expect([...(merged.yielded ?? [])].sort()).toEqual([
              '.tagma/settle/both.md',
              '.tagma/settle/catalog-new.md',
              '.tagma/settle/gone.md',
              '.tagma/settle/renamed.md',
            ]);
            const graph = yield* readBlockTree(join(project, '.tagma'));
            expect(graph.map((one) => [one.path, one.frontmatter.id, one.frontmatter.tags?.[0], one.body.trim()]).sort()).toEqual([
              ['settle/both.md', BOTH, 'note', 'The words as main rewrote them.'],
              ['settle/catalog-new.md', CATALOG, 'explanation', 'The catalog as main renamed it.'],
              ['settle/index.md', ROOT, 'note', 'The root every block here stands under.'],
              ['settle/moved/child.md', CHILD, 'note', 'The child main gave it.'],
              ['settle/moved/index.md', MOVED, 'explanation', REWRITTEN],
              ['settle/renamed.md', RENAMED, 'note', lines('as main rewrote this line.')],
            ]);
          }),
        ),
      120_000,
    );
  },
);
