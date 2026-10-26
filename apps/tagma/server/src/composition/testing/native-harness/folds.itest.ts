import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Data, Effect, Exit, Tracer } from 'effect';
import { asc, eq } from 'drizzle-orm';
import { Message } from '@runlith/llm/schema/messages';
import { WIRE_PAGE_MAX_BYTES, WIRE_PAGE_MAX_ENTRIES } from '@runlith/agent/protocol/cap';
import type { ThreadRow } from '@runlith/agent/thread/rows';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import type { ThreadToolEntry } from '@runlith/agent/transcript/entries';
import { threadLog, typeOf } from '../../../native-harness/testing/doubles.js';
import { threadEntry } from '../../../threads/testing/doubles.js';
import { StorageFixture, storageFixture } from './storage.fixture.js';

type Stand = StorageFixture['Service'];

const call = (stage: string) => ({
  type: 'tool' as const,
  id: 'call-1',
  runId: 'run-1',
  toolName: 'read',
  toolCallId: 'call-1',
  toolState: 'input-available' as const,
  toolInput: { stage },
});

const spoken = (index: number, runId: string) => ({
  id: `event-${index}`,
  kind: 'message',
  payload: {
    entry: {
      type: 'message' as const,
      id: `entry-${index}`,
      runId,
      role: (index % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      text: `line ${index}`,
      occurredAt: `2026-01-01T00:00:0${index}.000Z`,
    },
    messages: [Message.make({ role: index % 2 === 0 ? 'user' : 'assistant', content: `line ${index}` })],
  },
});

const carry = (it: Stand, thread: ThreadRow, from: number, count: number, runId = 'run-1') =>
  it.threads.transaction((tx) =>
    Effect.forEach(
      Array.from({ length: count }, (_, at) => from + at),
      (index) => it.events.append({ ...spoken(index, runId), id: `${thread.id}-event-${index}`, threadId: thread.id }, tx),
    ),
  );

const cursorsOf = (it: Stand, id: string) => it.db.select().from(threadLog()).where(eq(threadLog().threadId, id)).get();

const rowsOf = (it: Stand, id: string) =>
  it.db
    .select({ ord: threadEntry().ord, entryId: threadEntry().entryId })
    .from(threadEntry())
    .where(eq(threadEntry().threadId, id))
    .orderBy(asc(threadEntry().ord));

const touch = (it: Stand, id: string) => it.fold(id, (row) => Effect.succeed({ history: [...row.history] }));

const walked = Effect.fnUntraced(function* (it: Stand, id: string, limit: number) {
  const seen: string[] = [];
  let cursor: number | null | undefined;
  do {
    const page = yield* it.threads.transcriptWindow(id, { before: cursor ?? undefined, limit, bytes: 1_000_000 });
    seen.unshift(...(page?.entries ?? []).map((entry) => entry.id));
    cursor = page?.before;
  } while (cursor !== null && cursor !== undefined);
  return seen;
});

const stored = (at: number): ThreadTranscriptEntry => ({
  type: 'tool',
  id: `call-${at}`,
  runId: 'run-1',
  toolName: 'read',
  toolCallId: `call-${at}`,
  toolState: 'output-available',
  toolOutput: { text: 'x'.repeat(300_000) },
});

const context = (at: number): ThreadTranscriptEntry => ({
  type: 'context',
  id: `ctx-${at}`,
  runId: 'run-1',
  text: 'x'.repeat(200_000),
});

class GaveUp extends Data.TaggedError('GaveUp') {}

layer(storageFixture)('thread folds', (it) => {
  it.effect('a fold door replays its own cursor and builds no other fold', () =>
    Effect.gen(function* () {
      const stand = yield* StorageFixture;
      const thread = yield* stand.threads.insert({ ownerId: 'owner', agentId: 'agent' });
      yield* carry(stand, thread, 0, 1);
      yield* touch(stand, thread.id);
      expect(yield* cursorsOf(stand, thread.id)).toMatchObject({ historyThrough: 1, entriesThrough: 1 });

      yield* carry(stand, thread, 1, 1);
      const spans: Tracer.NativeSpan[] = [];
      const tracer = Tracer.make({
        span(options) {
          const span = new Tracer.NativeSpan(options);
          spans.push(span);
          return span;
        },
      });
      const history = yield* stand.threads.historyOf(thread.id).pipe(Effect.withTracer(tracer));

      expect(history).toHaveLength(2);
      const replays = spans
        .filter((span) => span.name === 'ThreadStorage.suffix.replay')
        .map((span) => Object.fromEntries(span.attributes));
      expect(replays).toMatchObject([{ threadId: thread.id, fold: 'history', events: 1 }]);
    }),
  );

  it.effect('an ordinary write materializes the standing suffix and moves the cursor to what it wrote', () =>
    Effect.gen(function* () {
      const stand = yield* StorageFixture;
      const thread = yield* stand.threads.insert({ ownerId: 'owner', agentId: 'agent' });
      yield* carry(stand, thread, 0, 2);
      expect(yield* cursorsOf(stand, thread.id)).toMatchObject({ entriesThrough: 0 });
      expect(yield* rowsOf(stand, thread.id)).toEqual([]);
      expect((yield* stand.threads.transcriptOf(thread.id))?.map((entry) => entry.id)).toEqual(['entry-0', 'entry-1']);

      yield* touch(stand, thread.id);

      expect(yield* cursorsOf(stand, thread.id)).toMatchObject({ entriesThrough: 2 });
      expect((yield* rowsOf(stand, thread.id)).map((row) => row.entryId)).toEqual(['entry-0', 'entry-1']);
      expect((yield* stand.threads.transcriptOf(thread.id))?.map((entry) => entry.id)).toEqual(['entry-0', 'entry-1']);
    }),
  );

  it.effect('facts that place nothing still let the cursor past them', () =>
    Effect.gen(function* () {
      const stand = yield* StorageFixture;
      const thread = yield* stand.threads.insert({ ownerId: 'owner', agentId: 'agent' });
      yield* stand.threads.transaction((tx) =>
        stand.events.append({ threadId: thread.id, id: `${thread.id}-probe`, kind: 'probe', payload: {} }, tx),
      );

      yield* touch(stand, thread.id);

      expect(yield* cursorsOf(stand, thread.id)).toMatchObject({ entriesThrough: 1, historyThrough: 1 });
      expect(yield* rowsOf(stand, thread.id)).toEqual([]);
    }),
  );

  it.effect('the slice reads answer the same fold before and after it is materialized', () =>
    Effect.gen(function* () {
      const stand = yield* StorageFixture;
      const thread = yield* stand.threads.insert({ ownerId: 'owner', agentId: 'agent' });
      yield* carry(stand, thread, 0, 2, 'run-1');
      yield* carry(stand, thread, 2, 2, 'run-2');

      const before = {
        ofRun1: (yield* stand.threads.entriesOfRun(thread.id, 'run-1')).map((entry) => entry.id),
        ofRun2: (yield* stand.threads.entriesOfRun(thread.id, 'run-2')).map((entry) => entry.id),
        one: (yield* stand.threads.entryById(thread.id, 'entry-3'))?.id,
        missing: yield* stand.threads.entryById(thread.id, 'entry-99'),
        page: (yield* stand.threads.transcriptWindow(thread.id, { limit: 10, bytes: 1_000_000 }))?.entries.map((entry) => entry.id),
      };
      expect(before.ofRun1).toEqual(['entry-0', 'entry-1']);
      expect(before.ofRun2).toEqual(['entry-2', 'entry-3']);
      expect(before.one).toBe('entry-3');
      expect(before.missing).toBeUndefined();

      yield* touch(stand, thread.id);

      expect((yield* stand.threads.entriesOfRun(thread.id, 'run-1')).map((entry) => entry.id)).toEqual(before.ofRun1);
      expect((yield* stand.threads.entriesOfRun(thread.id, 'run-2')).map((entry) => entry.id)).toEqual(before.ofRun2);
      expect((yield* stand.threads.entryById(thread.id, 'entry-3'))?.id).toBe('entry-3');
      expect(yield* stand.threads.entryById(thread.id, 'entry-99')).toBeUndefined();
      expect(before.page).toEqual(['entry-0', 'entry-1', 'entry-2', 'entry-3']);
      expect((yield* stand.threads.transcriptWindow(thread.id, { limit: 10, bytes: 1_000_000 }))?.entries.map((entry) => entry.id)).toEqual(
        before.page,
      );
    }),
  );

  it.effect('a withdrawal above the cursor is materialized once and is idempotent', () =>
    Effect.gen(function* () {
      const stand = yield* StorageFixture;
      const thread = yield* stand.threads.insert({ ownerId: 'owner', agentId: 'agent' });
      yield* carry(stand, thread, 0, 2, 'run-1');
      yield* carry(stand, thread, 2, 2, 'run-2');
      yield* stand.threads.transaction((tx) =>
        stand.events.append(
          {
            threadId: thread.id,
            id: `${thread.id}-stop`,
            kind: 'stopped',
            payload: { withdrawn: { runId: 'run-2', keepMessages: 2 } },
          },
          tx,
        ),
      );

      const folded = (yield* stand.threads.transcriptOf(thread.id))?.map((entry) => entry.id);
      expect(folded).toEqual(['entry-0', 'entry-1']);

      yield* touch(stand, thread.id);
      expect((yield* rowsOf(stand, thread.id)).map((row) => row.entryId)).toEqual(['entry-0', 'entry-1']);
      expect(yield* cursorsOf(stand, thread.id)).toMatchObject({ entriesThrough: 5 });
      expect(yield* stand.threads.historyOf(thread.id)).toHaveLength(2);

      yield* touch(stand, thread.id);
      expect((yield* rowsOf(stand, thread.id)).map((row) => row.entryId)).toEqual(['entry-0', 'entry-1']);
    }),
  );

  it.effect('a unit that rolls back leaves the fold and its cursor untouched', () =>
    Effect.gen(function* () {
      const stand = yield* StorageFixture;
      const thread = yield* stand.threads.insert({ ownerId: 'owner', agentId: 'agent' });
      yield* carry(stand, thread, 0, 1);

      const failed = yield* Effect.exit(
        stand.fold(thread.id, (_row, tx) =>
          Effect.gen(function* () {
            yield* stand.events.append({ threadId: thread.id, ...spoken(1, 'run-1'), id: `${thread.id}-event-1` }, tx);
            return yield* Effect.die(new Error('the body failed'));
          }),
        ),
      );
      expect(Exit.isFailure(failed)).toBe(true);

      expect(yield* cursorsOf(stand, thread.id)).toMatchObject({ entriesThrough: 0, historyThrough: 0 });
      expect(yield* rowsOf(stand, thread.id)).toEqual([]);
      expect((yield* stand.threads.transcriptOf(thread.id))?.map((entry) => entry.id)).toEqual(['entry-0']);
      yield* touch(stand, thread.id);
      expect(yield* cursorsOf(stand, thread.id)).toMatchObject({ entriesThrough: 1 });
    }),
  );

  it.effect('a fact appended inside the callback is materialized by the write that carried it', () =>
    Effect.gen(function* () {
      const stand = yield* StorageFixture;
      const thread = yield* stand.threads.insert({ ownerId: 'owner', agentId: 'agent' });

      yield* stand.fold(thread.id, (_row, tx) =>
        Effect.gen(function* () {
          yield* stand.events.append({ threadId: thread.id, ...spoken(0, 'run-1'), id: `${thread.id}-event-0` }, tx);
          return { placements: [] as const };
        }),
      );

      expect(yield* cursorsOf(stand, thread.id)).toMatchObject({ entriesThrough: 1 });
      expect((yield* rowsOf(stand, thread.id)).map((row) => row.entryId)).toEqual(['entry-0']);
    }),
  );

  it.effect('placements for facts the projection already materialized are not written twice', () =>
    Effect.gen(function* () {
      const stand = yield* StorageFixture;
      const thread = yield* stand.threads.insert({ ownerId: 'owner', agentId: 'agent' });
      yield* carry(stand, thread, 0, 2);

      yield* stand.fold(thread.id, () =>
        Effect.succeed({
          placements: [
            { kind: 'append' as const, entry: spoken(0, 'run-1').payload.entry },
            { kind: 'append' as const, entry: spoken(1, 'run-1').payload.entry },
            {
              kind: 'append' as const,
              entry: { type: 'message' as const, id: 'beside-the-log', role: 'assistant' as const, text: 'aside' },
            },
          ],
        }),
      );

      expect((yield* rowsOf(stand, thread.id)).map((row) => row.entryId)).toEqual(['entry-0', 'entry-1', 'beside-the-log']);
      expect(yield* cursorsOf(stand, thread.id)).toMatchObject({ entriesThrough: 2 });
    }),
  );

  it.effect('a fact appended between a history read and a fold in one unit survives to the reopened thread', () =>
    Effect.gen(function* () {
      const stand = yield* StorageFixture;
      const thread = yield* stand.threads.insert({ ownerId: 'owner', agentId: 'agent' });

      yield* stand.threads.transaction((tx) =>
        Effect.gen(function* () {
          yield* stand.threads.historyOf(thread.id, tx);
          yield* stand.events.append({ threadId: thread.id, ...spoken(0, 'run-1'), id: `${thread.id}-event-0` }, tx);
          yield* stand.fold(
            thread.id,
            (row, unit) =>
              Effect.gen(function* () {
                const second = yield* stand.events.append({ threadId: thread.id, ...spoken(1, 'run-1'), id: `${thread.id}-event-1` }, unit);
                return {
                  history: [...row.history, Message.make({ role: 'assistant', content: 'line 1' })],
                  covered: { from: second.position - 1, through: second.position },
                };
              }),
            tx,
          );
        }),
      );

      expect(yield* stand.threads.historyOf(thread.id)).toHaveLength(2);
      expect(yield* cursorsOf(stand, thread.id)).toMatchObject({ historyThrough: 2 });
      expect((yield* stand.threads.transcriptOf(thread.id))?.map((entry) => entry.id)).toEqual(['entry-0', 'entry-1']);
    }),
  );

  it.effect('a fact standing unplaced beside a row already written folds around it, and no ordinal moves', () =>
    Effect.gen(function* () {
      const stand = yield* StorageFixture;
      const thread = yield* stand.threads.insert({ ownerId: 'owner', agentId: 'agent' });
      yield* carry(stand, thread, 0, 2);
      yield* stand.threads.transaction((tx) =>
        tx.run(
          stand.db.insert(threadEntry()).values({
            threadId: thread.id,
            ord: 0,
            entryId: 'entry-1',
            runId: 'run-1',
            type: typeOf(spoken(1, 'run-1').payload.entry),
            entry: spoken(1, 'run-1').payload.entry,
          }),
        ),
      );
      expect(yield* cursorsOf(stand, thread.id)).toMatchObject({ entriesThrough: 0 });

      yield* touch(stand, thread.id);

      expect((yield* rowsOf(stand, thread.id)).map((row) => [row.ord, row.entryId])).toEqual([
        [0, 'entry-1'],
        [1, 'entry-0'],
      ]);
      expect(yield* cursorsOf(stand, thread.id)).toMatchObject({ entriesThrough: 2 });
      expect((yield* stand.threads.transcriptOf(thread.id))?.map((entry) => entry.id)).toEqual(['entry-1', 'entry-0']);
      expect((yield* stand.threads.transcriptWindow(thread.id, { limit: 10, bytes: 1_000_000 }))?.entries.map((entry) => entry.id)).toEqual(
        ['entry-1', 'entry-0'],
      );
    }),
  );

  it.effect('a cold page answers the whole fold, and its cursor names the same entries after the catch-up', () =>
    Effect.gen(function* () {
      const stand = yield* StorageFixture;
      const thread = yield* stand.threads.insert({ ownerId: 'owner', agentId: 'agent' });
      yield* carry(stand, thread, 0, 5);
      expect(yield* cursorsOf(stand, thread.id)).toMatchObject({ entriesThrough: 0 });
      const all = ['entry-0', 'entry-1', 'entry-2', 'entry-3', 'entry-4'];

      const newest = yield* stand.threads.transcriptWindow(thread.id, { limit: 2, bytes: 1_000_000 });
      expect(newest?.entries.map((entry) => entry.id)).toEqual(['entry-3', 'entry-4']);
      expect(newest?.before).toBe(3);
      expect(yield* walked(stand, thread.id, 2)).toEqual(all);

      const held = newest?.before ?? null;
      yield* touch(stand, thread.id);
      expect(yield* cursorsOf(stand, thread.id)).toMatchObject({ entriesThrough: 5 });
      expect(yield* walked(stand, thread.id, 2)).toEqual(all);
      const resumed = yield* stand.threads.transcriptWindow(thread.id, { before: held as number, limit: 2, bytes: 1_000_000 });
      expect(resumed?.entries.map((entry) => entry.id)).toEqual(['entry-1', 'entry-2']);
      expect(resumed?.before).toBe(1);
    }),
  );

  it.effect('a cold page shows transitions in place, hides a withdrawn run, and holds its budgets', () =>
    Effect.gen(function* () {
      const stand = yield* StorageFixture;
      const thread = yield* stand.threads.insert({ ownerId: 'owner', agentId: 'agent' });
      yield* carry(stand, thread, 0, 3, 'run-1');
      yield* touch(stand, thread.id);
      yield* carry(stand, thread, 3, 2, 'run-2');
      yield* stand.threads.transaction((tx) =>
        Effect.forEach(
          [
            { id: `${thread.id}-again`, kind: 'message', payload: { entry: { ...spoken(1, 'run-1').payload.entry, text: 'corrected' } } },
            { id: `${thread.id}-stop`, kind: 'stopped', payload: { withdrawn: { runId: 'run-2', keepMessages: 0 } } },
          ],
          (event) => stand.events.append({ threadId: thread.id, ...event }, tx),
        ),
      );

      const page = yield* stand.threads.transcriptWindow(thread.id, { limit: 10, bytes: 1_000_000 });
      expect(page?.entries.map((entry) => entry.id)).toEqual(['entry-0', 'entry-1', 'entry-2']);
      expect(page?.entries[1]).toMatchObject({ text: 'corrected' });
      expect(page?.before).toBeNull();
      expect((yield* stand.threads.transcriptOf(thread.id))?.map((entry) => entry.id)).toEqual(page?.entries.map((entry) => entry.id));
      yield* touch(stand, thread.id);
      expect((yield* rowsOf(stand, thread.id)).map((row) => row.entryId)).toEqual(['entry-0', 'entry-1', 'entry-2']);

      const bounded = yield* stand.threads.transcriptWindow(thread.id, { limit: 10, bytes: 1 });
      expect(bounded?.entries.map((entry) => entry.id)).toEqual(['entry-2']);
      expect(bounded?.before).not.toBeNull();
    }),
  );

  it.effect('a page over the wire ceiling is weighed by the capped size, and the fat row does not end it alone', () =>
    Effect.gen(function* () {
      const stand = yield* StorageFixture;
      const thread = yield* stand.threads.insert({ ownerId: 'owner', agentId: 'agent' });
      const transcript = Array.from({ length: 4 }, (_unused, at) => stored(at));
      yield* stand.fold(thread.id, () => Effect.succeed({ placements: transcript.map((entry) => ({ kind: 'append' as const, entry })) }));

      const page = yield* stand.threads.transcriptWindow(thread.id, { limit: WIRE_PAGE_MAX_ENTRIES, bytes: WIRE_PAGE_MAX_BYTES });

      expect(page?.entries.map((entry) => entry.id)).toEqual(transcript.map((entry) => entry.id));
      expect(page?.before).toBeNull();
      expect((page?.entries[0] as ThreadToolEntry).toolOutput).toEqual({ text: 'x'.repeat(300_000) });
    }),
  );

  it.effect('an entry the wire never cuts is weighed at its stored size, and the page ends at the budget', () =>
    Effect.gen(function* () {
      const stand = yield* StorageFixture;
      const thread = yield* stand.threads.insert({ ownerId: 'owner', agentId: 'agent' });
      const transcript = Array.from({ length: 6 }, (_unused, at) => context(at));
      yield* stand.fold(thread.id, () => Effect.succeed({ placements: transcript.map((entry) => ({ kind: 'append' as const, entry })) }));

      const page = yield* stand.threads.transcriptWindow(thread.id, { limit: WIRE_PAGE_MAX_ENTRIES, bytes: WIRE_PAGE_MAX_BYTES });

      expect(page?.entries.map((entry) => entry.id)).toEqual(['ctx-1', 'ctx-2', 'ctx-3', 'ctx-4', 'ctx-5']);
      expect(JSON.stringify(page?.entries).length).toBeLessThanOrEqual(WIRE_PAGE_MAX_BYTES);

      const older = yield* stand.threads.transcriptWindow(thread.id, {
        before: page?.before as number,
        limit: WIRE_PAGE_MAX_ENTRIES,
        bytes: WIRE_PAGE_MAX_BYTES,
      });
      expect(older?.entries.map((entry) => entry.id)).toEqual(['ctx-0']);
      expect(older?.before).toBeNull();
    }),
  );

  it.effect('an unplaced fact is weighed the way its row is, so the page is the same across the catch-up', () =>
    Effect.gen(function* () {
      const stand = yield* StorageFixture;
      const thread = yield* stand.threads.insert({ ownerId: 'owner', agentId: 'agent' });
      yield* stand.threads.transaction((tx) =>
        Effect.forEach([0, 1, 2, 3], (at) =>
          stand.events.append({ threadId: thread.id, id: `${thread.id}-event-${at}`, kind: 'tool', payload: { entry: stored(at) } }, tx),
        ),
      );

      const cold = yield* stand.threads.transcriptWindow(thread.id, { limit: WIRE_PAGE_MAX_ENTRIES, bytes: WIRE_PAGE_MAX_BYTES });
      yield* touch(stand, thread.id);
      const warm = yield* stand.threads.transcriptWindow(thread.id, { limit: WIRE_PAGE_MAX_ENTRIES, bytes: WIRE_PAGE_MAX_BYTES });

      expect(cold?.entries.map((entry) => entry.id)).toEqual(['call-0', 'call-1', 'call-2', 'call-3']);
      expect(cold?.before).toBeNull();
      expect(warm).toEqual(cold);
    }),
  );

  it.effect('a page reads its own unit, and a rolled back unit leaves it where it stood', () =>
    Effect.gen(function* () {
      const stand = yield* StorageFixture;
      const thread = yield* stand.threads.insert({ ownerId: 'owner', agentId: 'agent' });
      yield* carry(stand, thread, 0, 1);

      const inside = yield* stand.threads.transaction((tx) =>
        Effect.gen(function* () {
          yield* stand.events.append({ threadId: thread.id, ...spoken(1, 'run-1'), id: `${thread.id}-event-1` }, tx);
          return yield* stand.threads.transcriptWindow(thread.id, { limit: 10, bytes: 1_000_000 }, tx);
        }),
      );
      expect(inside?.entries.map((entry) => entry.id)).toEqual(['entry-0', 'entry-1']);

      const failure = yield* Effect.flip(
        stand.threads.transaction((tx) =>
          Effect.gen(function* () {
            yield* stand.events.append({ threadId: thread.id, ...spoken(2, 'run-1'), id: `${thread.id}-event-2` }, tx);
            return yield* new GaveUp();
          }),
        ),
      );
      expect(failure).toBeInstanceOf(GaveUp);

      const after = yield* stand.threads.transcriptWindow(thread.id, { limit: 10, bytes: 1_000_000 });
      expect(after?.entries.map((entry) => entry.id)).toEqual(['entry-0', 'entry-1']);
      expect(yield* cursorsOf(stand, thread.id)).toMatchObject({ entriesThrough: 0 });
    }),
  );

  it.effect('repeated transitions of a standing entry write only what moved, never the whole transcript', () =>
    Effect.gen(function* () {
      const stand = yield* StorageFixture;
      const thread = yield* stand.threads.insert({ ownerId: 'owner', agentId: 'agent' });
      yield* carry(stand, thread, 0, 2);
      yield* stand.threads.transaction((tx) =>
        stand.events.append(
          {
            threadId: thread.id,
            id: `${thread.id}-call-born`,
            kind: 'tool',
            payload: { entry: call('running') },
          },
          tx,
        ),
      );
      yield* touch(stand, thread.id);
      const settled = ['reading', 'done'];
      yield* stand.threads.transaction((tx) =>
        Effect.forEach(settled, (state, at) =>
          stand.events.append(
            {
              threadId: thread.id,
              id: `${thread.id}-call-${at}`,
              kind: 'tool',
              payload: { entry: call(state) },
            },
            tx,
          ),
        ),
      );

      const spans: Tracer.NativeSpan[] = [];
      const tracer = Tracer.make({
        span(options) {
          const span = new Tracer.NativeSpan(options);
          spans.push(span);
          return span;
        },
      });
      yield* touch(stand, thread.id).pipe(Effect.withTracer(tracer));

      const replays = spans
        .filter((span) => span.name === 'ThreadStorage.suffix.replay')
        .map((span) => Object.fromEntries(span.attributes))
        .filter((attributes) => attributes.fold === 'entries');
      expect(replays).toMatchObject([{ threadId: thread.id, fold: 'entries', events: 2, rows: 2 }]);

      expect((yield* rowsOf(stand, thread.id)).map((row) => row.entryId)).toEqual(['entry-0', 'entry-1', 'call-1']);
      expect(yield* stand.threads.entryById(thread.id, 'call-1')).toMatchObject({ toolInput: { stage: 'done' } });
    }),
  );

  it.effect('an entry the log never carried keeps its ordinal through a catch-up', () =>
    Effect.gen(function* () {
      const stand = yield* StorageFixture;
      const thread = yield* stand.threads.insert({ ownerId: 'owner', agentId: 'agent' });
      yield* carry(stand, thread, 0, 2);
      yield* stand.threads.transaction((tx) =>
        Effect.forEach(
          [
            { ord: 0, entryId: 'entry-1', entry: spoken(1, 'run-1').payload.entry },
            {
              ord: 1,
              entryId: 'beside-the-log',
              entry: { type: 'message' as const, id: 'beside-the-log', role: 'assistant' as const, text: 'aside' },
            },
          ],
          (row) => tx.run(stand.db.insert(threadEntry()).values({ threadId: thread.id, runId: 'run-1', type: typeOf(row.entry), ...row })),
        ),
      );

      yield* touch(stand, thread.id);

      expect((yield* rowsOf(stand, thread.id)).map((row) => [row.ord, row.entryId])).toEqual([
        [0, 'entry-1'],
        [1, 'beside-the-log'],
        [2, 'entry-0'],
      ]);
    }),
  );

  it.effect('a history whose fold does not meet the log the read covered is refused, and nothing lands', () =>
    Effect.gen(function* () {
      const stand = yield* StorageFixture;
      const thread = yield* stand.threads.insert({ ownerId: 'owner', agentId: 'agent' });

      const failure = yield* Effect.flip(
        stand.fold(thread.id, (row, tx) =>
          Effect.gen(function* () {
            yield* stand.events.append({ threadId: thread.id, ...spoken(0, 'run-1'), id: `${thread.id}-event-0` }, tx);
            const second = yield* stand.events.append({ threadId: thread.id, ...spoken(1, 'run-1'), id: `${thread.id}-event-1` }, tx);
            return {
              history: [...row.history, Message.make({ role: 'user', content: 'line 1' })],
              covered: { from: second.position - 1, through: second.position },
            };
          }),
        ),
      );
      expect(failure).toMatchObject({ _tag: 'ThreadStorageFailed', call: 'transition' });

      expect(yield* stand.threads.historyOf(thread.id)).toEqual([]);
      expect(yield* cursorsOf(stand, thread.id)).toMatchObject({ historyThrough: 0, entriesThrough: 0 });
    }),
  );
});
