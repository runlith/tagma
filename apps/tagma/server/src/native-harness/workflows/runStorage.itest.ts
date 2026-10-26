import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { describeWorkflowRunStoragePort } from '@runlith/agent/workflow/conformance';
import { Clock, Context, Effect, Layer } from 'effect';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { unitsLayer } from '../../platform/store/units.js';
import { seededStoreLayer } from '../../platform/store/open.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { project } from '../../projects/store/table.js';
import { bornThread } from '../testing/born.js';
import { THREAD_AUTHORITY_DEFAULT } from '@runlith/agent/thread/rows';
import { makeWorkflowRuns } from './runStorage.js';

describeWorkflowRunStoragePort(
  'Tagma bun:sqlite',
  Effect.fnUntraced(function* () {
    const context = yield* Layer.build(
      unitsLayer(MachineUnits, MachineStore).pipe(
        Layer.provideMerge(Layer.orDie(seededStoreLayer(MachineStore, fixtureMigrations, {}, sharedPool))),
      ),
    );
    const { db } = Context.get(context, MachineStore);
    const created = yield* db
      .insert(project)
      .values({
        name: 'p',
        repoKey: '/p',
        rootPath: '/p',
        createdAt: new Date(yield* Clock.currentTimeMillis),
      })
      .returning({ id: project.id })
      .get();
    if (!created) return yield* Effect.die('The project could not be created.');
    yield* bornThread(
      db,
      {
        id: 'thread-1',
        ownerId: 'o',
        agentId: 'tagma',
        spawnRootId: 'thread-1',
        cacheGroup: 'thread-1',
        authority: THREAD_AUTHORITY_DEFAULT,
      },
      { projectId: created.id, createdBySessionId: null },
    );
    return yield* Effect.provide(makeWorkflowRuns, context);
  }),
);
