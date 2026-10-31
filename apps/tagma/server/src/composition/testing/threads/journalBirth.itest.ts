import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { join } from 'node:path';
import { Context, Clock, Effect, FileSystem, Layer, Schema } from 'effect';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { ENTRY_KINDS } from '../composed.js';
import { eq } from 'drizzle-orm';
import { THREAD_AUTHORITY_DEFAULT } from '@runlith/agent/thread/rows';
import { threadStoreFixture } from '../threadStoreFixture.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { writes } from '../../../platform/contract/service/writes.js';
import { bornThread } from '../../../native-harness/testing/born.js';
import { nativeOnlyParts } from '../../../native-harness/testing/rollout.js';
import {
  rolloutBirth,
  rolloutWriter,
  filedThreadJournal,
  replayThreadRollout,
  threadEvent,
  threadResource,
  threadRolloutCursor,
  threadRolloutRefusal,
} from '../../../threads/testing/doubles.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import { threadRecord } from '../../../thread-record/testing/doubles.js';

const fact = (threadId: string, id: string) => ({
  threadId,
  id,
  kind: 'message',
  payload: { entry: { type: 'message', id, role: 'user', text: id } },
});

const setup = Effect.fnUntraced(function* () {
  const fixture = yield* threadStoreFixture;
  const runtime = Context.add(Context.merge(fixture.context, yield* Layer.build(BunFileSystem.layer)), ThreadEntryKinds, ENTRY_KINDS);
  const pathOf = (_projectId: number, threadId: string) => join(home, `${threadId}.jsonl`);
  const files = Context.get(runtime, FileSystem.FileSystem);
  const lineSchema = Schema.fromJsonString(
    Schema.Struct({
      kind: Schema.optional(Schema.String),
      record: Schema.optional(Schema.Struct({ id: Schema.String })),
      row: Schema.optional(Schema.Struct({ id: Schema.String })),
    }),
  );
  const rows = Effect.fn('testing.birthJournalLines')(function* (threadId: string) {
    const text = yield* files.readFileString(pathOf(projectId, threadId));
    return yield* Effect.forEach(text.trim().split('\n'), (line) => Schema.decodeUnknownEffect(lineSchema)(line));
  });
  const journal = () => Effect.provide(filedThreadJournal(rolloutWriter(pathOf, rolloutBirth(store, nativeOnlyParts))), runtime);
  const append = (opened: Effect.Success<ReturnType<typeof journal>>, threadId: string, id: string) =>
    units.write(writes('journal-birth', [threadEvent()]), (unit) => opened.append(fact(threadId, id), unit));
  const born = Effect.fnUntraced(function* (id: string) {
    yield* Effect.provide(
      bornThread(
        store.db,
        { id, ownerId: 'owner', agentId: 'tagma', spawnRootId: id, cacheGroup: id, authority: THREAD_AUTHORITY_DEFAULT },
        { projectId },
      ),
      runtime,
    );
  });
  const store = Context.get(runtime, MachineStore);
  const units = Context.get(runtime, MachineUnits);
  const home = yield* Context.get(runtime, FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: 'journal-birth-' });
  const projectId = fixture.projectId;
  return { runtime, store, units, home, projectId, pathOf, rows, journal, append, born, files };
});

it.live(
  'the first journal open completes an interrupted birth before anything is written',
  Effect.fnUntraced(function* () {
    const { runtime, store, units, home, projectId, pathOf, rows, journal, append, born, files } = yield* setup();
    yield* born('unprepared');
    yield* Effect.provide(
      store.db.insert(threadResource()).values({
        kind: 'rollout',
        id: `${projectId}/unprepared`,
        threadId: 'unprepared',
        heldAt: new Date(yield* Clock.currentTimeMillis),
      }),
      runtime,
    );
    expect(yield* files.exists(pathOf(projectId, 'unprepared'))).toBe(false);
    const opened = yield* journal();
    yield* Effect.provide(opened.open('unprepared'), runtime);
    const first = yield* Effect.provide(append(opened, 'unprepared', 'first'), runtime);
    const second = yield* Effect.provide(append(opened, 'unprepared', 'second'), runtime);
    expect([first.position, second.position]).toEqual([1, 2]);
    const file = yield* rows('unprepared');
    expect(file[0]?.record?.id).toBe('unprepared');
    expect(file.filter((entry) => entry.kind === 'event').map((entry) => entry.row?.id)).toEqual(['first', 'second']);
    const recorded = yield* Effect.provide(store.db.select().from(threadEvent()).where(eq(threadEvent().threadId, 'unprepared')), runtime);
    expect(recorded.map((entry) => entry.id)).toEqual(['first', 'second']);
    const held = yield* Effect.provide(
      store.db.select().from(threadResource()).where(eq(threadResource().threadId, 'unprepared')),
      runtime,
    );
    yield* Effect.provide(store.db.delete(threadResource()).where(eq(threadResource().threadId, 'unprepared')), runtime);
    yield* Effect.provide(store.db.delete(threadRecord()).where(eq(threadRecord().id, 'unprepared')), runtime);
    yield* Effect.provide(
      replayThreadRollout({
        path: pathOf(projectId, 'unprepared'),
        parts: nativeOnlyParts,
        records: yield* Effect.provide(makeThreadRecords, runtime),
      }).pipe(Effect.provideService(MachineStore, store), Effect.provideService(ThreadEntryKinds, ENTRY_KINDS)),
      runtime,
    );
    expect(
      yield* Effect.provide(store.db.select().from(threadResource()).where(eq(threadResource().threadId, 'unprepared')), runtime),
    ).toEqual(held);
  }),
);

it.live(
  'a missing earlier journal is refused without creating a replacement',
  Effect.fnUntraced(function* () {
    const { runtime, store, units, home, projectId, pathOf, rows, journal, append, born, files } = yield* setup();
    for (const kind of ['cursor', 'refusal', 'event'] as const) {
      const id = `prior-${kind}`;
      yield* born(id);
      if (kind === 'cursor')
        yield* Effect.provide(
          store.db
            .insert(threadRolloutCursor())
            .values({ threadId: id, nextPosition: 2, restedAt: new Date(yield* Clock.currentTimeMillis) }),
          runtime,
        );
      if (kind === 'refusal')
        yield* Effect.provide(
          store.db.insert(threadRolloutRefusal()).values({
            threadId: id,
            reason: 'io',
            message: 'missing',
            nextByteOffset: 0,
            nextPosition: 1,
            seenAt: new Date(yield* Clock.currentTimeMillis),
          }),
          runtime,
        );
      if (kind === 'event') yield* Effect.provide(store.db.insert(threadEvent()).values({ ...fact(id, 'earlier'), position: 1 }), runtime);
      const refused = yield* journal();
      yield* Effect.provide(refused.open(id), runtime);
      const result = yield* Effect.provide(Effect.result(append(refused, id, 'new')), runtime);
      expect(result._tag).toBe('Failure');
      if (result._tag === 'Failure') expect(result.failure._tag).toBe('ThreadStorageFailed');
      expect(yield* files.exists(pathOf(projectId, id))).toBe(false);
      expect(
        (yield* Effect.provide(store.db.select().from(threadEvent()).where(eq(threadEvent().threadId, id)), runtime)).map((row) => row.id),
      ).not.toContain('new');
    }
  }),
);

it.live(
  'an unpublished birth can be rebuilt from its standing rows after interruption',
  Effect.fnUntraced(function* () {
    const { runtime, store, units, home, projectId, pathOf, rows, journal, append, born, files } = yield* setup();
    const id = 'partial-birth';
    yield* born(id);
    const path = pathOf(projectId, id);
    yield* files.writeFileString(`${path}.partial`, '{"record":');
    const opened = yield* journal();
    yield* Effect.provide(opened.open(id), runtime);
    expect((yield* Effect.provide(append(opened, id, 'partial-first'), runtime)).position).toBe(1);
    const file = yield* rows(id);
    expect(file[0]?.record?.id).toBe(id);
    expect(file.filter((entry) => entry.kind === 'event').map((entry) => entry.row?.id)).toEqual(['partial-first']);
    expect(yield* files.exists(`${path}.partial`)).toBe(false);
  }),
);

it.live(
  'a compressed or incomplete journal is preserved instead of replaced at birth',
  Effect.fnUntraced(function* () {
    const { runtime, store, units, home, projectId, pathOf, rows, journal, append, born, files } = yield* setup();
    for (const suffix of ['.zst', '.opening', '']) {
      const id = `file-${suffix || 'empty'}`;
      yield* born(id);
      const path = pathOf(projectId, id);
      yield* files.writeFileString(`${path}${suffix}`, '');
      const refused = yield* journal();
      yield* Effect.provide(refused.open(id), runtime);
      const result = yield* Effect.provide(Effect.result(append(refused, id, 'new')), runtime);
      expect(result._tag).toBe('Failure');
      expect(yield* files.readFileString(`${path}${suffix}`)).toBe('');
      if (suffix !== '') expect(yield* files.exists(path)).toBe(false);
    }
  }),
);
