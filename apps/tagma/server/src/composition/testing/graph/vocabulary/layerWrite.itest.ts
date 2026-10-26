import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { Blocks } from '../../../../graph/contract/service/blocks.js';
import { BlockNames } from '../../../../graph/contract/service/acts.js';
import { InstalledCatalogs } from '../../../../graph/contract/service/vocabulary.js';
import { demoGraphLayer, withDemo } from '../../graphFixture.js';
import { ensureVocabulary } from '../../../../graph/serving/birth.js';

const installedTask = Effect.fnUntraced(function* (projectId: number) {
  const catalogs = yield* (yield* InstalledCatalogs).read(projectId);
  const catalog = catalogs.find((entry) => entry.id === 'software-development');
  if (catalog === undefined) return yield* Effect.die('software-development is not installed');
  const { idOfName } = yield* BlockNames;
  const { blockById } = yield* Blocks;
  for (const name of catalog.tags) {
    const row = yield* blockById(yield* idOfName(name));
    if (row.fields.id === 'task') return row;
  }
  return yield* Effect.die('task is not installed');
});

layer(demoGraphLayer(), { excludeTestServices: true })('layer writes', (it) => {
  it.effect('an installed type accepts an empty keyed layer, and a declared fork keeps its text through installation', () =>
    withDemo(({ graph, projectId, table }) =>
      Effect.gen(function* () {
        const task = yield* installedTask(projectId);
        const type = (yield* table()).identities.typeOf('task');
        if (type === null) return yield* Effect.die('task has no identity');
        const layer = { type: type.id, edits: [] };
        yield* graph.blocks.update({ id: task.id, fields: { layer } });
        const written = yield* graph.blocks.blockById(task.id);
        expect(written.fields.layer).toEqual(layer);
        expect(written.body).toBe(task.body);
        const fork = { library: 'software-development', export: 'task', at: 'revision' };
        yield* graph.blocks.update({ id: task.id, body: 'Our task, forked.', fields: { fork } });
        yield* ensureVocabulary('machine');
        expect((yield* graph.blocks.blockById(task.id)).fields.fork).toEqual(fork);
        expect((yield* table()).tagById('task')?.prompt).toBe('Our task, forked.');
      }),
    ),
  );
});
