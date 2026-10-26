import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { fixtureMigrations } from '../migrations.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { dirname, join } from 'node:path';
import { eq } from 'drizzle-orm';
import { Context, Clock, Effect, FileSystem, Layer } from 'effect';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import type { ThreadEventPayload } from '@runlith/agent/thread/events';
import type { ThreadToolState } from '@runlith/agent/transcript/entries';
import { Message } from '@runlith/llm/schema/messages';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits, type WriteUnit } from '../../../platform/contract/service/units.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { seededStoreLayer } from '../../../platform/store/open.js';
import { project } from '../../../projects/testing/doubles.js';
import { threadLog, restedFolds, threadStore, type ThreadStore } from '../../../native-harness/testing/doubles.js';
import { threadEntry } from '../../../threads/testing/doubles.js';
import { scopeRecord } from '../../../thread-record/testing/records.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import { restFor } from '../../../threads/testing/rest.js';
import { nativeOnlyParts } from '../../../native-harness/testing/rollout.js';
import { threadEvent } from '../../../threads/testing/doubles.js';
import { exportThreadRollout } from '../../../threads/testing/doubles.js';
import { rehydrateThreadRecords } from '../../../threads/testing/doubles.js';
import { restedReads } from '../../../threads/testing/doubles.js';

import { sqliteThreadJournal } from '../../../threads/testing/doubles.js';
import { compressRollout, evictThreadProjection, threadProjection } from '../../../threads/testing/doubles.js';
import { ENTRY_KINDS } from '../../manifest.js';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { RolloutReads } from '../../../threads/contract/service/rolloutReads.js';

const text = (id: string, body: string): ThreadTranscriptEntry => ({ id, type: 'message', role: 'assistant', text: body });

it.live(
  'a rested thread answers the same page the rows answered, opening no write unit',
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
    const home = yield* Context.get(runtime, FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: 'rested-reads-' });
    const store = yield* Effect.provide(MachineStore, runtime);
    const units = yield* Effect.provide(MachineUnits, runtime);
    const projectId = yield* Effect.provide(
      Effect.map(
        store.db
          .insert(project())
          .values({ name: 'reads', repoKey: '/reads', rootPath: '/reads', createdAt: new Date(yield* Clock.currentTimeMillis) })
          .returning({ id: project().id })
          .get(),
        (row) => row?.id ?? 0,
      ),
      runtime,
    );
    const rows = yield* Effect.provide(
      Effect.flatMap(makeThreadRecords, (records) => threadStore(records, ENTRY_KINDS)),
      runtime,
    );
    const row = yield* Effect.provide(rows.insert({ ownerId: 'operator', agentId: 'tagma' }), runtime);
    yield* Effect.provide(Effect.void.pipe(Effect.andThen(scopeRecord(store.db, row.id, { projectId }))), runtime);
    const entries = [text('e1', 'first'), text('e2', 'second'), text('e3', 'third')];
    const prompt: ThreadTranscriptEntry = { id: 'sp', type: 'system-prompt', text: 'frozen' };
    yield* Effect.provide(
      Effect.gen(function* () {
        yield* store.db.insert(threadEvent()).values([
          { threadId: row.id, position: 1, id: 'event-sp', kind: 'system-prompt', payload: { entry: prompt } },
          ...entries.map((carried, at) => ({
            threadId: row.id,
            position: at + 2,
            id: `event-${carried.id}`,
            kind: 'entry',
            payload: { entry: carried },
          })),
        ]);
        yield* store.db.insert(threadEntry()).values([
          { threadId: row.id, ord: -1, entryId: prompt.id, runId: null, type: 'system-prompt', entry: prompt },
          ...entries.map((carried, ord) => ({
            threadId: row.id,
            ord,
            entryId: carried.id,
            runId: null,
            type: 'text',
            entry: carried,
          })),
        ]);
        yield* store.db.update(threadLog()).set({ historyThrough: 4, entriesThrough: 4 }).where(eq(threadLog().threadId, row.id));
      }),
      runtime,
    );

    const fromRows = yield* Effect.provide(rows.transcriptWindow(row.id, { limit: 2, bytes: 10_000_000 }), runtime);
    const eventsFromRows = yield* Effect.provide(
      Effect.flatMap(sqliteThreadJournal(), (log) => log.eventsAfter(row.id, 0, 10)),
      runtime,
    );
    const olderRows = yield* Effect.provide(
      rows.transcriptWindow(row.id, { limit: 2, bytes: 10_000_000, before: fromRows?.before ?? 0 }),
      runtime,
    );

    const path = join(home, String(projectId), `${row.id}.jsonl`);
    yield* Effect.provide(exportThreadRollout({ threadId: row.id, path, parts: nativeOnlyParts }), runtime);
    yield* Effect.provide(
      Effect.gen(function* () {
        yield* store.db.delete(threadEntry()).where(eq(threadEntry().threadId, row.id));
        yield* restFor(store.db, row.id, new Date(yield* Clock.currentTimeMillis));
      }),
      runtime,
    );

    let writes = 0;
    const counted: MachineUnits['Service'] = {
      read: (work) => units.read(work),
      markReadOnly: (effect) => units.markReadOnly(effect),
      markWrite: (effect) => units.markWrite(effect),
      write: <T, E>(
        operation: Parameters<MachineUnits['Service']['write']>[0],
        work: (unit: WriteUnit<'machine'>) => Effect.Effect<T, E>,
      ) => {
        writes += 1;
        return units.write(operation, work);
      },
    };
    const reads = yield* Effect.provide(restedReads(ENTRY_KINDS, home).pipe(Effect.provideService(MachineUnits, counted)), runtime);
    const rested = yield* Effect.provide(
      Effect.flatMap(Effect.all([makeThreadRecords, restedFolds(reads, ENTRY_KINDS)]), ([records, folds]) =>
        threadStore(records, ENTRY_KINDS, folds),
      ).pipe(Effect.provideService(MachineUnits, counted)),
      runtime,
    );

    const fromFile = yield* Effect.provide(rested.transcriptWindow(row.id, { limit: 2, bytes: 10_000_000 }), runtime);
    const olderFromFile = yield* Effect.provide(
      rested.transcriptWindow(row.id, { limit: 2, bytes: 10_000_000, before: fromFile?.before ?? 0 }),
      runtime,
    );
    expect(fromFile?.entries.map((carried) => carried.id)).toEqual(fromRows?.entries.map((carried) => carried.id));
    expect(olderFromFile?.entries.map((carried) => carried.id)).toEqual(olderRows?.entries.map((carried) => carried.id));
    expect(yield* Effect.provide(rested.transcriptOf(row.id), runtime)).toEqual([prompt, ...entries]);
    expect(
      yield* Effect.provide(
        Effect.flatMap(sqliteThreadJournal(reads), (log) => log.eventsAfter(row.id, 0, 10)).pipe(
          Effect.provideService(MachineUnits, counted),
        ),
        runtime,
      ),
    ).toEqual(eventsFromRows);
    yield* Effect.provide(
      rehydrateThreadRecords({ threadId: row.id, path, parts: nativeOnlyParts }).pipe(Effect.provideService(ThreadEntryKinds, ENTRY_KINDS)),
      runtime,
    );
    expect(yield* Effect.provide(rows.transcriptWindow(row.id, { limit: 2, bytes: 10_000_000 }), runtime)).toEqual(fromFile);
    expect(writes).toBe(0);
  }),
);

const said = (id: string, runId: string): ThreadEventPayload => ({
  entry: { type: 'message', id, runId, role: 'assistant', text: id },
  messages: [Message.assistant(id)],
});

it.live(
  'a rested thread pages, reads and folds what the live fold answered through revisions, withdrawal, rewind and restore',
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
    const home = yield* Context.get(runtime, FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: 'rested-reads-' });
    const store = yield* Effect.provide(MachineStore, runtime);
    const projectId = yield* Effect.provide(
      Effect.map(
        store.db
          .insert(project())
          .values({ name: 'folds', repoKey: '/folds', rootPath: '/folds', createdAt: new Date(yield* Clock.currentTimeMillis) })
          .returning({ id: project().id })
          .get(),
        (row) => row?.id ?? 0,
      ),
      runtime,
    );
    const live = yield* Effect.provide(
      Effect.flatMap(makeThreadRecords, (records) => threadStore(records, ENTRY_KINDS)),
      runtime,
    );
    const row = yield* Effect.provide(live.insert({ ownerId: 'operator', agentId: 'tagma' }), runtime);
    yield* Effect.provide(scopeRecord(store.db, row.id, { projectId }), runtime);
    const payloads: ReadonlyArray<readonly [string, ThreadEventPayload]> = [
      ['system-prompt', { entry: { id: 'sp', type: 'system-prompt', text: 'frozen' } }],
      ['message', said('e1', 'run-1')],
      ['tool', call('a', 'input-available')],
      ['tool', call('a', 'output-available')],
      ['message', said('e2', 'run-2')],
      ['withdraw', { withdrawn: { runId: 'run-2', keepMessages: 2 } }],
      ['message', said('e3', 'run-3')],
      ['message', said('e4', 'run-4')],
      ['rewind', { rewound: { id: 'rw-1', scope: 'from', runIds: ['run-3', 'run-4'], cuts: [{ from: 2, to: 4 }] } }],
      [
        'restore',
        {
          restored: {
            rewindId: 'rw-1',
            runIds: ['run-4'],
            inserts: [{ at: 2, messages: [Message.assistant('e4')] }],
          },
        },
      ],
      ['message', said('e5', 'run-5')],
    ];
    yield* Effect.provide(
      store.db.insert(threadEvent()).values(
        payloads.map(([kind, payload], at) => ({
          threadId: row.id,
          position: at + 1,
          id: `event-${at + 1}`,
          kind,
          payload,
        })),
      ),
      runtime,
    );
    const ids = ['sp', 'e1', 'tool:a', 'e2', 'e3', 'e4', 'e5', 'missing'];
    const runs = ['run-1', 'run-2', 'run-3', 'run-4', 'run-5'];
    const answers = Effect.fnUntraced(function* (rows: ThreadStore) {
      const pages: unknown[] = [];
      for (const bytes of [10_000_000, 1]) {
        let before: number | undefined;
        do {
          const page = yield* rows.transcriptWindow(row.id, { before, limit: 2, bytes });
          pages.push(page?.entries);
          before = page?.before ?? undefined;
        } while (before !== undefined);
      }
      return {
        pages,
        logs: yield* rows.logs(row.id),
        byId: yield* Effect.forEach(ids, (entryId) => rows.entryById(row.id, entryId)),
        runs: yield* Effect.forEach(runs, (runId) => rows.entriesOfRun(row.id, runId)),
      };
    });

    const fromFold = yield* Effect.provide(answers(live), runtime);
    expect(fromFold.logs?.history).toHaveLength(4);
    expect(fromFold.logs?.transcript.map((entry) => [entry.id, 'rewound' in entry])).toEqual([
      ['sp', false],
      ['e1', false],
      ['tool:a', false],
      ['e3', true],
      ['e4', false],
      ['e5', false],
    ]);

    const path = join(home, String(projectId), `${row.id}.jsonl`);
    yield* Effect.provide(exportThreadRollout({ threadId: row.id, path, parts: nativeOnlyParts }), runtime);
    yield* Effect.provide(
      Effect.flatMap(threadProjection(ENTRY_KINDS), (projection) => projection.run({ threadId: row.id, path })),
      runtime,
    );
    const fs = Context.get(runtime, FileSystem.FileSystem);
    yield* fs.writeFileString(`${path}.entries.partial`, 'a build that died before its rename');
    expect(yield* Effect.provide(evictThreadProjection({ threadId: row.id, path, parts: nativeOnlyParts }), runtime)).toMatchObject({
      outcome: 'evicted',
    });
    expect((yield* fs.readDirectory(dirname(path))).filter((file) => file.endsWith('.partial'))).toEqual([]);
    const records = yield* Effect.provide(makeThreadRecords, runtime);
    const reads = yield* Effect.provide(restedReads(ENTRY_KINDS, home), runtime);
    const rested = Effect.flatMap(restedFolds(reads, ENTRY_KINDS), (folds) => threadStore(records, ENTRY_KINDS, folds));
    expect(yield* Effect.provide(Effect.flatMap(rested, answers), runtime)).toEqual(fromFold);

    yield* Effect.provide(compressRollout(path), runtime);
    const files = yield* Effect.provide(reads.restedRollout(row.id), runtime);
    if (files == null) return yield* Effect.die(new Error('the rested thread has no transcript files'));
    yield* fs.remove(files.transcript, { force: true });
    expect(yield* Effect.provide(Effect.flatMap(rested, answers), runtime)).toEqual(fromFold);
  }),
);

const asked = (questionId: string, runId: string, status: 'open' | 'answered'): ThreadEventPayload => ({
  entry: { type: 'question', id: questionId, runId, questionId, questions: [], toolCalls: [], status },
});

it.live(
  'a rested thread answers its open questions from the transcript’s open table, in order, and an older transcript is rebuilt to answer them',
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
    const fs = Context.get(runtime, FileSystem.FileSystem);
    const home = yield* fs.makeTempDirectoryScoped({ prefix: 'rested-open-' });
    const store = yield* Effect.provide(MachineStore, runtime);
    const projectId = yield* Effect.provide(
      Effect.map(
        store.db
          .insert(project())
          .values({ name: 'open', repoKey: '/open', rootPath: '/open', createdAt: new Date(yield* Clock.currentTimeMillis) })
          .returning({ id: project().id })
          .get(),
        (row) => row?.id ?? 0,
      ),
      runtime,
    );
    const records = yield* Effect.provide(makeThreadRecords, runtime);
    const row = yield* Effect.provide(
      Effect.flatMap(threadStore(records, ENTRY_KINDS), (threads) => threads.insert({ ownerId: 'operator', agentId: 'tagma' })),
      runtime,
    );
    yield* Effect.provide(scopeRecord(store.db, row.id, { projectId }), runtime);
    const approvals = `approvals:${row.id}`;
    const payloads: ReadonlyArray<readonly [string, ThreadEventPayload]> = [
      ['entry', { entry: text('long', 'x'.repeat(200_000)) }],
      ['question', asked('q1', approvals, 'open')],
      ['question', asked('q2', approvals, 'open')],
      ['question', asked('q1', approvals, 'answered')],
      ['question', asked('q3', 'run-x', 'open')],
      ['question', asked('q4', approvals, 'open')],
    ];
    yield* Effect.provide(
      store.db
        .insert(threadEvent())
        .values(payloads.map(([kind, payload], at) => ({ threadId: row.id, position: at + 1, id: `event-${at + 1}`, kind, payload }))),
      runtime,
    );
    const path = join(home, String(projectId), `${row.id}.jsonl`);
    yield* Effect.provide(exportThreadRollout({ threadId: row.id, path, parts: nativeOnlyParts }), runtime);
    yield* Effect.provide(
      Effect.gen(function* () {
        yield* store.db.delete(threadEvent()).where(eq(threadEvent().threadId, row.id));
        yield* restFor(store.db, row.id, new Date(yield* Clock.currentTimeMillis));
      }),
      runtime,
    );
    const reads = yield* Effect.provide(restedReads(ENTRY_KINDS, home), runtime);
    const rested = yield* Effect.provide(
      Effect.flatMap(restedFolds(reads, ENTRY_KINDS), (folds) => threadStore(records, ENTRY_KINDS, folds)),
      runtime,
    );
    const open = Effect.provide(
      Effect.map(rested.openQuestionsOfRun(row.id, approvals), (entries) => entries.map((entry) => entry.id)),
      runtime,
    );
    expect(yield* open).toEqual(['q2', 'q4']);
    let bytes = 0;
    expect(yield* open.pipe(Effect.provideService(RolloutReads, (read) => void (bytes += read.bytes)))).toEqual(['q2', 'q4']);
    expect([bytes > 0, bytes < 10_000]).toEqual([true, true]);

    const files = yield* Effect.provide(reads.restedRollout(row.id), runtime);
    if (files == null) return yield* Effect.die(new Error('the rested thread has no transcript files'));
    const built = Buffer.from(yield* fs.readFile(files.transcript));
    const footer = built.subarray(built.length - 48);
    const [entries, bodies] = [footer.readDoubleLE(0), footer.readDoubleLE(8)];
    const older = Buffer.alloc(32);
    older.writeDoubleLE(entries, 0);
    older.writeDoubleLE(bodies, 8);
    older.writeDoubleLE(footer.readDoubleLE(24), 16);
    older.writeDoubleLE(footer.readDoubleLE(32), 24);
    yield* fs.writeFile(files.transcript, Buffer.concat([built.subarray(0, bodies + entries * 16), older]));
    expect(yield* open).toEqual(['q2', 'q4']);
    expect((yield* fs.readFile(files.transcript)).length).toBe(built.length);
  }),
);

const call = (toolCallId: string, toolState: ThreadToolState): ThreadEventPayload => ({
  entry: { type: 'tool', id: `tool:${toolCallId}`, runId: 'run-1', toolCallId, toolName: 'bash', toolState },
});

it.live(
  'a rested thread answers every window, revision page and record lookup the rows answered before it rested',
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
    const home = yield* Context.get(runtime, FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: 'rested-reads-' });
    const store = yield* Effect.provide(MachineStore, runtime);
    const projectId = yield* Effect.provide(
      Effect.map(
        store.db
          .insert(project())
          .values({ name: 'windows', repoKey: '/windows', rootPath: '/windows', createdAt: new Date(yield* Clock.currentTimeMillis) })
          .returning({ id: project().id })
          .get(),
        (row) => row?.id ?? 0,
      ),
      runtime,
    );
    const row = yield* Effect.provide(
      Effect.flatMap(
        Effect.flatMap(makeThreadRecords, (records) => threadStore(records, ENTRY_KINDS)),
        (threads) => threads.insert({ ownerId: 'operator', agentId: 'tagma' }),
      ),
      runtime,
    );
    yield* Effect.provide(scopeRecord(store.db, row.id, { projectId }), runtime);
    const payloads: ReadonlyArray<readonly [string, ThreadEventPayload]> = [
      ['system-prompt', { entry: { id: 'sp', type: 'system-prompt', text: 'frozen' } }],
      ['tool', call('a', 'input-available')],
      ['entry', { entry: text('e1', 'first') }],
      ['tool', call('b', 'input-available')],
      ['tool', call('a', 'output-available')],
      ['entry', { entry: text('e2', 'x'.repeat(200_000)) }],
      ['signal', {}],
      ['tool', call('b', 'output-error')],
      ['entry', { entry: text('e3', 'third') }],
      ['tool', call('c', 'input-available')],
    ];
    yield* Effect.provide(
      store.db.insert(threadEvent()).values(
        payloads.map(([kind, payload], at) => ({
          threadId: row.id,
          position: at + 1,
          id: `event-${at + 1}`,
          kind,
          payload,
        })),
      ),
      runtime,
    );

    const windows = [
      ...[10, 7].flatMap((head) => [0, 1, 3, 5, 6, 8, 9].map((afterPosition) => ({ head, afterPosition, limit: 2 }))),
      { head: 10, afterPosition: 0, limit: 100, kinds: ['tool'] },
      { head: 10, afterPosition: 4, limit: 1, kinds: ['tool', 'entry'] },
    ];
    const lookups = ['event-2', 'tool:a', 'tool:run-1:a', 'tool:run-1:b', 'tool:run-2:a', 'missing'];
    const answers = (log: Effect.Success<ReturnType<typeof sqliteThreadJournal>>) =>
      Effect.all({
        revisions: Effect.forEach(windows, (window) => log.revisionsAsOf(row.id, window)),
        records: Effect.forEach(windows, (window) => log.recordsAsOf(row.id, window)),
        after: Effect.forEach([0, 4, 9, 10], (after) => log.eventsAfter(row.id, after, 3)),
        positions: Effect.forEach(lookups, (recordId) => log.positionOf(row.id, recordId)),
      });

    const fromRows = yield* Effect.provide(Effect.flatMap(sqliteThreadJournal(), answers), runtime);
    const path = join(home, String(projectId), `${row.id}.jsonl`);
    yield* Effect.provide(exportThreadRollout({ threadId: row.id, path, parts: nativeOnlyParts }), runtime);
    yield* Effect.provide(
      Effect.gen(function* () {
        yield* store.db.delete(threadEvent()).where(eq(threadEvent().threadId, row.id));
        yield* restFor(store.db, row.id, new Date(yield* Clock.currentTimeMillis));
      }),
      runtime,
    );
    const fromFile = yield* Effect.provide(
      Effect.flatMap(Effect.flatMap(restedReads(ENTRY_KINDS, home), sqliteThreadJournal), answers),
      runtime,
    );

    expect(fromRows.revisions[1]?.map((revision) => [revision.identity, revision.position])).toEqual([
      ['e1', 3],
      ['tool:run-1:a', 5],
    ]);
    expect(fromRows.positions).toEqual([2, 5, 5, 8, null, null]);
    expect(fromFile).toEqual(fromRows);
  }),
);
