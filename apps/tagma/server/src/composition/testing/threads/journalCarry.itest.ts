import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { join } from 'node:path';
import { Context, Effect, FileSystem, Layer, Schema } from 'effect';
import { asc, eq } from 'drizzle-orm';
import { THREAD_AUTHORITY_DEFAULT } from '@runlith/agent/thread/rows';
import { threadStoreFixture } from '../threadStoreFixture.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { writes } from '../../../platform/contract/service/writes.js';
import { nativeRows } from '../../../threads/store/kernel.js';
import { bornThread } from '../../../native-harness/testing/born.js';
import { nativeOnlyParts } from '../../../native-harness/testing/rollout.js';
import { threadCompactionStore } from '../../../native-harness/testing/doubles.js';
import {
  evictThreadProjection,
  rolloutBirth,
  filedThreadJournal,
  rolloutWriter,
  sqliteThreadJournal,
  threadEvent,
  threadProjection,
} from '../../../threads/testing/doubles.js';
import { ENTRY_KINDS } from '../composed.js';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';

const fact = (threadId: string, id: string) => ({
  threadId,
  id,
  kind: 'message',
  payload: { entry: { type: 'message', id, role: 'user', text: id } },
});

type Journal = Effect.Success<ReturnType<typeof filedThreadJournal>>;

const setup = Effect.fnUntraced(function* () {
  const fixture = yield* threadStoreFixture;
  const runtime = Context.merge(fixture.context, yield* Layer.build(BunFileSystem.layer));
  const pathOf = (_projectId: number, threadId: string) => join(home, `${threadId}.jsonl`);
  const parts = yield* nativeOnlyParts;
  const journal = (writer = rolloutWriter(pathOf, rolloutBirth(store, parts))) => Effect.provide(filedThreadJournal(writer), runtime);
  const commit = (written: Journal, threadId: string, ids: readonly string[]) =>
    units.write(writes('journal-carry', [threadEvent(), nativeRows]), (unit) =>
      Effect.forEach(ids, (id) => written.append(fact(threadId, id), unit)),
    );
  const files = Context.get(runtime, FileSystem.FileSystem);
  const lineSchema = Schema.fromJsonString(
    Schema.Struct({
      kind: Schema.optional(Schema.String),
      row: Schema.optional(Schema.Struct({ position: Schema.Int, id: Schema.String })),
    }),
  );
  const filed = Effect.fn('testing.carriedJournalLines')(function* (threadId: string) {
    const text = yield* files.readFileString(pathOf(projectId, threadId));
    const lines = yield* Effect.forEach(text.trim().split('\n'), (line) => Schema.decodeUnknownEffect(lineSchema)(line));
    return lines.flatMap((line) => (line.kind === 'event' && line.row !== undefined ? [[line.row.position, line.row.id] as const] : []));
  });
  const logged = Effect.fnUntraced(function* (threadId: string) {
    return (yield* Effect.provide(
      store.db.select().from(threadEvent()).where(eq(threadEvent().threadId, threadId)).orderBy(asc(threadEvent().position)),
      runtime,
    )).map((row) => [row.position, row.id] as const);
  });
  const opened = Effect.fnUntraced(function* (id: string, writer?: Parameters<typeof journal>[0]) {
    yield* Effect.provide(
      bornThread(
        store.db,
        { id, ownerId: 'owner', agentId: 'tagma', spawnRootId: id, cacheGroup: id, authority: THREAD_AUTHORITY_DEFAULT },
        { projectId },
      ),
      runtime,
    );
    const written = yield* journal(writer);
    yield* Effect.provide(written.open(id), runtime);
    return written;
  });
  const store = Context.get(runtime, MachineStore);
  const units = Context.get(runtime, MachineUnits);
  const home = yield* Context.get(runtime, FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: 'journal-carry-' });
  const projectId = fixture.projectId;
  return { runtime, store, units, home, projectId, pathOf, journal, commit, filed, logged, opened };
});

it.live(
  'commits of one thread racing for the writer land in the file in the order of their numbers',
  Effect.fnUntraced(function* () {
    const { runtime, store, units, home, projectId, pathOf, journal, commit, filed, logged, opened } = yield* setup();
    const written = yield* opened('racing');
    yield* Effect.provide(
      Effect.all([commit(written, 'racing', ['a-1', 'a-2']), commit(written, 'racing', ['b-1', 'b-2'])], { concurrency: 2 }),
      runtime,
    );
    yield* Effect.provide(written.open('racing'), runtime);
    expect(yield* filed('racing')).toEqual(yield* logged('racing'));
    expect((yield* filed('racing')).map(([position]) => position)).toEqual([1, 2, 3, 4]);
  }),
);

it.live(
  'a unit that rolls back leaves no line behind, and the next commit takes the same number in the log and the file',
  Effect.fnUntraced(function* () {
    const { runtime, store, units, home, projectId, pathOf, journal, commit, filed, logged, opened } = yield* setup();
    const written = yield* opened('rolled-back');
    yield* Effect.provide(commit(written, 'rolled-back', ['kept-1']), runtime);
    const turned = yield* Effect.provide(
      Effect.result(
        units.write(writes('journal-carry', [threadEvent(), nativeRows]), (unit) =>
          Effect.andThen(written.append(fact('rolled-back', 'lost'), unit), Effect.fail('turned back')),
        ),
      ),
      runtime,
    );
    expect(turned._tag).toBe('Failure');
    yield* Effect.provide(commit(written, 'rolled-back', ['kept-2']), runtime);
    expect(yield* logged('rolled-back')).toEqual([
      [1, 'kept-1'],
      [2, 'kept-2'],
    ]);
    expect(yield* filed('rolled-back')).toEqual([
      [1, 'kept-1'],
      [2, 'kept-2'],
    ]);
  }),
);

it.live(
  'a pruning mark reaches the rollout when its unit commits, and never when the unit rolls back',
  Effect.fnUntraced(function* () {
    const { runtime, store, units, projectId, pathOf, opened } = yield* setup();
    const id = 'pruned';
    const writer = rolloutWriter(pathOf, rolloutBirth(store, yield* nativeOnlyParts));
    yield* opened(id, writer);
    const carried: unknown[] = [];
    const compaction = yield* Effect.provide(
      threadCompactionStore({ onRecords: (_threadId, record) => void carried.push(record) }),
      runtime,
    );
    const prunedInFile = Effect.fnUntraced(function* () {
      yield* Effect.forEach(carried.splice(0), (record) => writer.appendRecord(id, projectId, record), { discard: true });
      const text = yield* Context.get(runtime, FileSystem.FileSystem).readFileString(pathOf(projectId, id));
      return text
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { kind?: string; row?: { toolCallId: string } })
        .flatMap((line) => (line.kind === 'pruned' && line.row !== undefined ? [line.row.toolCallId] : []));
    });
    const turned = yield* Effect.provide(
      Effect.result(
        units.write('compaction-mark', (unit) =>
          Effect.andThen(
            compaction.markToolCallsPrunedIn(id, [{ toolCallId: 'rolled-back', tokens: 1 }], unit),
            Effect.fail('turned back'),
          ),
        ),
      ),
      runtime,
    );
    expect(turned._tag).toBe('Failure');
    expect(yield* prunedInFile()).toEqual([]);
    yield* Effect.provide(
      units.write('compaction-mark', (unit) => compaction.markToolCallsPrunedIn(id, [{ toolCallId: 'committed', tokens: 1 }], unit)),
      runtime,
    );
    expect(yield* prunedInFile()).toEqual(['committed']);
    expect(yield* Effect.provide(compaction.prunedToolCalls(id), runtime)).toEqual(new Set(['committed']));
  }),
);

it.live(
  'an append whose number the rollout already holds is refused and leaves the log as it stood',
  Effect.fnUntraced(function* () {
    const { runtime, store, units, home, projectId, pathOf, journal, commit, filed, logged, opened } = yield* setup();
    const id = 'behind';
    const written = yield* opened(id);
    yield* Effect.provide(commit(written, id, ['filed']), runtime);
    yield* Effect.provide(store.db.delete(threadEvent()).where(eq(threadEvent().threadId, id)), runtime);
    const result = yield* Effect.provide(Effect.result(commit(written, id, ['clashing'])), runtime);
    expect(result._tag).toBe('Failure');
    expect(yield* logged(id)).toEqual([]);
    expect(yield* filed(id)).toEqual([[1, 'filed']]);
  }),
);

it.live(
  'rows committed before their file write are kept from eviction and carried in at their numbers by the next open',
  Effect.fnUntraced(function* () {
    const { runtime, store, units, home, projectId, pathOf, journal, commit, filed, logged, opened } = yield* setup();
    const id = 'interrupted';
    const written = yield* opened(id);
    const projection = yield* Effect.provide(threadProjection(ENTRY_KINDS), runtime);
    const parts = yield* nativeOnlyParts;
    const evict = () =>
      Effect.provide(
        evictThreadProjection({ threadId: id, path: pathOf(projectId, id), parts }).pipe(
          Effect.provideService(MachineStore, store),
          Effect.provideService(ThreadEntryKinds, ENTRY_KINDS),
        ),
        runtime,
      );
    yield* Effect.provide(commit(written, id, ['before']), runtime);
    yield* Effect.provide(commit(yield* Effect.provide(sqliteThreadJournal(), runtime), id, ['unwritten']), runtime);
    yield* Effect.provide(projection.run({ threadId: id, path: pathOf(projectId, id) }), runtime);
    expect(yield* filed(id)).toEqual([[1, 'before']]);
    expect(yield* evict()).toEqual({ outcome: 'kept', reason: 'records-missing' });
    yield* Effect.provide((yield* journal()).open(id), runtime);
    expect(yield* filed(id)).toEqual([
      [1, 'before'],
      [2, 'unwritten'],
    ]);
    yield* Effect.provide(projection.run({ threadId: id, path: pathOf(projectId, id) }), runtime);
    expect((yield* evict()).outcome).toBe('evicted');
  }),
);
