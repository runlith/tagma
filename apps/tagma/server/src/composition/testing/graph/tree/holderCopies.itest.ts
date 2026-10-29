import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import { demoGraphLayer, withDemo } from '../../graphFixture.js';
import { tagNodeFields } from '../../../../graph/vocabulary/declarationRules.js';
import { tagsOfCatalogs } from '../../../../catalogs/contract/wire/registry.js';
import { CORE_LIBRARY } from '../../../../graph/contract/wire/tags/identity.js';
import { type TreeBlock, writeBlockTree } from '../../../../graph/tree/layout.js';
import { rebuildMirror } from '../../../../graph/tree/mirror.js';
import { projectToTree } from '../../../../graph/tree/projection.js';
import { scanTree } from '../../../../graph/tree/scan.js';

const ROOT = '0198aaaa-0000-7000-8000-00000000a001';
const TASK = '0198aaaa-0000-7000-8000-00000000c003';
const TASK_TAG = '0198aaaa-0000-7000-8000-00000000e007';

const task = tagsOfCatalogs([CORE_LIBRARY, 'software-development']).find((candidate) => candidate.id === 'task')!;

const blocks: TreeBlock[] = [
  { parentId: null, frontmatter: { id: ROOT, title: 'Main', ord: 1 }, body: '' },
  { parentId: ROOT, frontmatter: { id: TASK_TAG, tags: ['tag'], title: '#task', ord: 1, fields: tagNodeFields(task) }, body: task.prompt },
  { parentId: ROOT, frontmatter: { id: TASK, tags: ['task'], title: 'Held work', ord: 2, fields: { status: 'open' } }, body: '' },
];

layer(demoGraphLayer().pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })(
  'holders across graph copies',
  (it) => {
    it.effect('a holder read into another graph copy names the session that claimed it, whatever local number that copy gives it', () =>
      Effect.gen(function* () {
        const main = yield* withDemo((demo) =>
          Effect.gen(function* () {
            const treeRoot = yield* demo.fixture.directory('main');
            yield* writeBlockTree(treeRoot, blocks);
            const built = yield* rebuildMirror(yield* scanTree(treeRoot), demo.projectId);
            const claimed = yield* demo.as('main', demo.graph.tasks.claim({ id: built.ids.get(TASK)! }));
            yield* projectToTree({ projectId: demo.projectId, treeRoot });
            return { files: (yield* scanTree(treeRoot)).blocks, holder: (yield* demo.table()).holderOf(claimed) };
          }),
        );
        yield* withDemo((demo) =>
          Effect.gen(function* () {
            yield* demo.as(
              'worktree',
              demo.graph.blocks.create({ projectId: demo.projectId, parentId: demo.root, title: 'Written first in this copy' }),
            );
            expect(yield* demo.graph.sessions.idOf({ harness: 'test', key: 'worktree' })).toBe(main.holder);
            const treeRoot = yield* demo.fixture.directory('worktree');
            yield* writeBlockTree(treeRoot, main.files);
            const built = yield* rebuildMirror(yield* scanTree(treeRoot), demo.projectId);
            const held = yield* demo.graph.blocks.rawBlockById(built.ids.get(TASK)!);
            expect((yield* demo.graph.sessions.writerOf((yield* demo.table()).holderOf(held)))?.key).toBe('main');
          }),
        );
      }),
    );
  },
);
