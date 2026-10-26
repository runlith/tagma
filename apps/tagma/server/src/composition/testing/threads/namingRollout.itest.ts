import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { fixtureMigrations } from '../migrations.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { join } from 'node:path';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { sql } from 'drizzle-orm';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { ENTRY_KINDS } from '../../manifest.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { seededStoreLayer } from '../../../platform/store/open.js';
import { project } from '../../../projects/testing/doubles.js';
import { threadRecord } from '../../../thread-record/testing/doubles.js';
import { bornThread } from '../../../native-harness/testing/born.js';
import { recordOf } from '../../../thread-record/testing/records.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import { nativeOnlyParts } from '../../../native-harness/testing/rollout.js';
import { exportThreadRollout } from '../../../threads/testing/doubles.js';
import { replayThreadRollout } from '../../../threads/testing/doubles.js';

it.live(
  'what a title attempt records leaves the rollout replayable',
  Effect.fnUntraced(function* () {
    const runtime = yield* Layer.build(
      unitsLayer(MachineUnits, MachineStore)
        .pipe(
          Layer.provideMerge(
            Layer.orDie(Layer.unwrap(Effect.map(sharedPool, (pool) => seededStoreLayer(MachineStore, fixtureMigrations, {}, pool)))),
          ),
        )
        .pipe(Layer.merge(Layer.succeed(ThreadEntryKinds, ENTRY_KINDS)), Layer.merge(BunFileSystem.layer)),
    );

    const db = (yield* Effect.provide(MachineStore, runtime)).db;
    const records = yield* Effect.provide(makeThreadRecords, runtime);
    const born = new Date('2026-09-06T10:00:00.000Z');
    const registered = yield* Effect.provide(
      db.insert(project()).values({ name: 'p', repoKey: '/p', rootPath: '/p', createdAt: born }).returning().get(),
      runtime,
    );
    yield* Effect.provide(
      bornThread(
        db,
        {
          id: 't-title',
          ownerId: 'owner',
          agentId: 'tagma',
          authority: { mode: 'trust', bypassFrom: null },
          profile: null,
          spawnRootId: 't-title',
          cacheGroup: 't-title',
          provider: 'subscription',
          model: 'claude-opus-5-5',
          status: 'idle',
          createdAt: born,
          updatedAt: born,
        },
        { projectId: registered.id, title: 'quiet harbor', titleOrigin: 'random' },
      ),
      runtime,
    );
    const home = yield* Context.get(runtime, FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: 'rollout-title-' });
    const path = join(home, 't-title.jsonl');
    yield* Effect.provide(exportThreadRollout({ threadId: 't-title', path, parts: nativeOnlyParts }), runtime);
    yield* Effect.provide(db.run(sql`delete from thread_log`), runtime);
    yield* Effect.provide(db.delete(threadRecord()), runtime);
    yield* Effect.provide(replayThreadRollout({ path, parts: nativeOnlyParts, records }), runtime);
    const facet = yield* Effect.provide(recordOf(db, 't-title'), runtime);
    expect(facet === undefined ? [] : [[facet.id, facet.title, facet.titleOrigin]]).toEqual([['t-title', 'quiet harbor', 'random']]);
    yield* Context.get(runtime, FileSystem.FileSystem).writeFileString(
      path,
      `${JSON.stringify({ kind: 'aside', usage: { totalTokens: 12 } })}\n`,
      { flag: 'a' },
    );
    yield* Effect.provide(db.run(sql`delete from thread_log`), runtime);
    yield* Effect.provide(db.delete(threadRecord()), runtime);
    const refused = yield* Effect.exit(Effect.provide(replayThreadRollout({ path, parts: nativeOnlyParts, records }), runtime));
    expect(refused._tag).toBe('Failure');
  }),
);
