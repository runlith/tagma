import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { asc, eq } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { decodeThreadEventPayload } from '@runlith/agent/thread/events';
import { ThreadEntryKinds, makeThreadEntryReader, type ThreadEntryReader } from '@runlith/agent/transcript/kinds';
import type { ThreadRow } from '@runlith/agent/thread/rows';
import type { ThreadEventPayloadValue } from '@runlith/agent/thread/storage/eventLog';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { unitsLayer } from '../../platform/store/units.js';
import { seededStoreLayer } from '../../platform/store/open.js';
import { threadLog } from '../store/thread.js';
import { threadEvent } from '../../threads/store/journal.js';
import { ROWS_PER_READ, makeFootprintFolding } from './footprintFolding.js';
import { makeSqliteThreadJournal } from '../../threads/journal/log.js';
import { makeThreadRecords } from '../../thread-record/layer.js';
import { CORE_KINDS, threadStore } from '../testing/doubles.js';

const machine = Layer.orDie(
  unitsLayer(MachineUnits, MachineStore).pipe(Layer.provideMerge(seededStoreLayer(MachineStore, fixtureMigrations, {}, sharedPool))),
);

const stand = Effect.fnUntraced(function* (kinds: ThreadEntryReader = CORE_KINDS) {
  const { db } = yield* MachineStore;
  return {
    db,
    threads: yield* threadStore(yield* makeThreadRecords, CORE_KINDS),
    events: yield* makeSqliteThreadJournal,
    folding: yield* makeFootprintFolding.pipe(Effect.provideService(ThreadEntryKinds, kinds)),
  };
});

type Stand = Effect.Success<ReturnType<typeof stand>>;

const toolsOf = (step: number): readonly string[] =>
  Array.from({ length: 40 }, (_, at) => `${step}`.padStart(2, '0').repeat(2) + `${at}`.padStart(62, 'd'));

const measurement = (step: number): ThreadEventPayloadValue =>
  ({
    measurement: {
      runId: 'run-1',
      stepNumber: step,
      attempt: 0,
      provider: 'subscription',
      model: 'claude-opus-5-5',
      usage: { inputTokens: 1000 + step, outputTokens: 7, totalTokens: 1007 + step },
      contextWindow: 200_000,
      inputLimit: null,
      measuredAt: `2026-09-14T10:0${step}:00.000Z`,
      sentAt: `2026-09-14T10:0${step}:00.000Z`,
      footprint: {
        messages: step + 1,
        messageDigest: `message-${step}`,
        promptDigest: 'prompt',
        toolDigests: toolsOf(step),
      },
    },
  }) as ThreadEventPayloadValue;

const carry = (on: Stand, thread: ThreadRow, steps: readonly number[]) =>
  on.threads.transaction((tx) =>
    Effect.forEach(steps, (step) =>
      on.events.append({ threadId: thread.id, id: `event-${thread.id}-${step}`, kind: 'measurement', payload: measurement(step) }, tx),
    ),
  );

const stored = (on: Stand, threadId: string) =>
  on.db
    .select({ position: threadEvent.position, payload: threadEvent.payload })
    .from(threadEvent)
    .where(eq(threadEvent.threadId, threadId))
    .orderBy(asc(threadEvent.position));

const cursor = (on: Stand, threadId: string) =>
  Effect.map(
    on.db.select({ at: threadLog.footprintsThrough }).from(threadLog).where(eq(threadLog.threadId, threadId)).get(),
    (row) => row?.at,
  );

it.live('a superseded measurement keeps its bill and gives up its tools; the newest keeps them', () =>
  Effect.gen(function* () {
    const on = yield* stand();
    const thread = yield* on.threads.insert({ ownerId: 'owner-1', agentId: 'tagma' });
    yield* carry(on, thread, [0, 1, 2, 3]);
    const before = yield* stored(on, thread.id);

    const report = yield* on.folding.pass();

    expect(report.folded).toBe(3);
    expect(report.newest).toBe(1);
    expect(report.bytesRemoved).toBeGreaterThan(0);

    const after = yield* stored(on, thread.id);
    expect(after).toHaveLength(4);
    for (const [at, row] of after.entries()) {
      const footprint = (row.payload as { measurement: { footprint?: Record<string, unknown> } }).measurement.footprint;
      if (at === after.length - 1) {
        expect(footprint?.toolDigests).toEqual(toolsOf(3));
        continue;
      }
      expect(footprint).toBeUndefined();
      const was = (before[at]!.payload as { measurement: Record<string, unknown> }).measurement;
      const now = (row.payload as { measurement: Record<string, unknown> }).measurement;
      expect({ ...now, footprint: undefined }).toEqual({ ...was, footprint: undefined });
    }

    const decoded = decodeThreadEventPayload(CORE_KINDS, after[0]!.payload) as { measurement?: Record<string, unknown> };
    expect(decoded.measurement?.footprint).toBeUndefined();
    expect(decoded.measurement?.usage).toEqual(expect.objectContaining({ inputTokens: 1000 }));
    expect(decoded.measurement?.sentAt).toBe('2026-09-14T10:00:00.000Z');
  }).pipe(Effect.provide(machine)),
);

it.live('an unmarked resident thread folds only its superseded footprint through the current-form reader', () =>
  Effect.gen(function* () {
    const current = (measurement(0) as { measurement: Record<string, unknown> }).measurement;
    const { sentAt, footprint, ...bill } = current;
    const old = { measurement: { ...bill, footprint, priorSentAt: sentAt } };
    const kinds = makeThreadEntryReader({
      products: [],
      steps: [
        {
          name: '20261010210000_measurement_sent',
          samples: { payload: old },
          payload: (payload) => {
            const measurement = payload.measurement as Record<string, unknown> | undefined;
            if (measurement?.priorSentAt === undefined) return null;
            const { priorSentAt, ...rest } = measurement;
            return { ...payload, measurement: { ...rest, sentAt: priorSentAt } };
          },
        },
      ],
    });
    const on = yield* stand(kinds);
    const thread = yield* on.threads.insert({ ownerId: 'owner', agentId: 'agent' });
    yield* on.threads.transaction((tx) =>
      Effect.gen(function* () {
        yield* on.events.append({ threadId: thread.id, id: 'old', kind: 'measurement', payload: old }, tx);
        yield* on.events.append({ threadId: thread.id, id: 'new', kind: 'measurement', payload: measurement(1) }, tx);
      }),
    );
    expect((yield* on.folding.pass()).folded).toBe(1);
    const rows = yield* stored(on, thread.id);
    expect(rows[0]!.payload).toEqual({ measurement: { ...bill, sentAt } });
    expect(rows[1]!.payload).toEqual(measurement(1));
  }).pipe(Effect.provide(machine)),
);

it.live('a thread carrying more standing footprints than one read takes is folded to its end', () =>
  Effect.gen(function* () {
    const on = yield* stand();
    const thread = yield* on.threads.insert({ ownerId: 'owner-1', agentId: 'tagma' });
    const carried = ROWS_PER_READ + 2;
    yield* carry(
      on,
      thread,
      Array.from({ length: carried }, (_, step) => step),
    );

    const report = yield* on.folding.pass();

    expect(report.folded).toBe(carried - 1);
    expect(report.newest).toBe(1);
    expect(report.seen).toBe(carried);
    expect(report.remaining).toBe(0);
    expect(yield* cursor(on, thread.id)).toBe(carried - 1);

    const after = yield* stored(on, thread.id);
    const footprint = (row: (typeof after)[number]) =>
      (row.payload as { measurement: { footprint?: Record<string, unknown> } }).measurement.footprint;
    expect(footprint(after.at(-1)!)?.toolDigests).toEqual(toolsOf(carried - 1));
    expect(footprint(after.at(-2)!)).toBeUndefined();
    expect(footprint(after[0]!)).toBeUndefined();
  }).pipe(Effect.provide(machine)),
);

it.live('the cursor stops below the newest, so a settled thread folds nothing and a later measurement folds one', () =>
  Effect.gen(function* () {
    const on = yield* stand();
    const thread = yield* on.threads.insert({ ownerId: 'owner-1', agentId: 'tagma' });
    yield* carry(on, thread, [0, 1, 2]);

    yield* on.folding.pass();
    expect(yield* cursor(on, thread.id)).toBe(2);

    const settled = yield* on.folding.pass();
    expect(settled.folded).toBe(0);
    expect(settled.seen).toBe(1);

    yield* carry(on, thread, [3]);
    const moved = yield* on.folding.pass();
    expect(moved.folded).toBe(1);
    expect(yield* cursor(on, thread.id)).toBe(3);
  }).pipe(Effect.provide(machine)),
);
