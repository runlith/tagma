import { fixtureMigrations } from '../migrations.js';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import { asc, eq } from 'drizzle-orm';
import { Message } from '@runlith/llm/schema/messages';
import type { ThreadRow } from '@runlith/agent/thread/rows';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { seededStoreLayer } from '../../../platform/store/open.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { threadHistoryItem, threadLog, threadStore } from '../../../native-harness/testing/doubles.js';
import { sqliteThreadJournal } from '../../../threads/testing/doubles.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import { threadFolder } from '../../../native-harness/testing/fold.js';
import { ENTRY_KINDS } from '../composed.js';

const storage = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(seededStoreLayer(MachineStore, fixtureMigrations, {}, sharedPool)),
);
const stand = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const threads = yield* threadStore(yield* makeThreadRecords, ENTRY_KINDS);
  return { threads, fold: yield* threadFolder(threads), events: yield* sqliteThreadJournal(), db };
});
type Stand = Effect.Success<typeof stand>;

const said = (text: string) => Message.make({ role: 'user' as const, content: text });

const spoke = (message: Message): string => ((message.content as readonly { text?: string }[])[0]?.text ?? '') as string;

const rowsOf = (fixture: Stand, id: string) =>
  fixture.db
    .select({ ord: threadHistoryItem().ord, message: threadHistoryItem().message })
    .from(threadHistoryItem())
    .where(eq(threadHistoryItem().threadId, id))
    .orderBy(asc(threadHistoryItem().ord));

const cursorOf = (fixture: Stand, id: string) =>
  Effect.map(fixture.db.select().from(threadLog()).where(eq(threadLog().threadId, id)).get(), (row) => row?.historyThrough);

const spoken = (threadId: string, index: number) => ({
  threadId,
  id: `${threadId}-event-${index}`,
  kind: 'message',
  payload: {
    entry: {
      type: 'message' as const,
      id: `entry-${index}`,
      runId: 'run-1',
      role: 'user' as const,
      text: `line ${index}`,
      occurredAt: new Date(1_000 + index).toISOString(),
    },
    messages: [said(`line ${index}`)],
  },
});

const write = (fixture: Stand, thread: ThreadRow, next: (held: readonly Message[]) => readonly Message[]) =>
  fixture.fold(thread.id, (row) => Effect.succeed({ history: next(row.history) }));

layer(storage, { excludeTestServices: true })('history rows', (it) => {
  it.effect('a thread reopens with the context it was appended, in the order it was written', () =>
    Effect.gen(function* () {
      const fixture = yield* stand;
      const thread = yield* fixture.threads.insert({ ownerId: 'owner', agentId: 'agent', history: [said('born')] });

      yield* write(fixture, thread, (held) => [...held, said('one')]);
      yield* write(fixture, thread, (held) => [...held, said('two')]);

      expect(yield* fixture.threads.historyOf(thread.id)).toEqual([said('born'), said('one'), said('two')]);
      expect((yield* rowsOf(fixture, thread.id)).map((row) => row.ord)).toEqual([0, 1, 2]);
    }),
  );

  it.effect('one message replaced in place leaves every other where it was', () =>
    Effect.gen(function* () {
      const fixture = yield* stand;
      const thread = yield* fixture.threads.insert({ ownerId: 'owner', agentId: 'agent', history: [said('a'), said('b'), said('c')] });

      yield* write(fixture, thread, (held) => [held[0] as Message, said('changed'), held[2] as Message]);

      expect(yield* fixture.threads.historyOf(thread.id)).toEqual([said('a'), said('changed'), said('c')]);
      expect((yield* rowsOf(fixture, thread.id)).map((row) => [row.ord, row.message])).toEqual([
        [0, said('a')],
        [1, said('changed')],
        [2, said('c')],
      ]);
    }),
  );

  it.effect('a withdrawal truncates the context and takes its rows with it', () =>
    Effect.gen(function* () {
      const fixture = yield* stand;
      const thread = yield* fixture.threads.insert({ ownerId: 'owner', agentId: 'agent', history: [said('a'), said('b'), said('c')] });

      yield* fixture.fold(thread.id, (_row, tx) =>
        Effect.gen(function* () {
          const withdrawal = yield* fixture.events.append(
            {
              threadId: thread.id,
              id: `${thread.id}-stop-1`,
              kind: 'stopped',
              payload: { withdrawn: { runId: 'run-1', keepMessages: 1 } },
            },
            tx,
          );
          return { history: [said('a')], covered: { from: withdrawal.position - 1, through: withdrawal.position } };
        }),
      );

      expect(yield* fixture.threads.historyOf(thread.id)).toEqual([said('a')]);
      expect((yield* rowsOf(fixture, thread.id)).map((row) => row.ord)).toEqual([0]);
    }),
  );

  it.effect('two compactions with equal then decreasing counts reopen to the active context', () =>
    Effect.gen(function* () {
      const fixture = yield* stand;
      const thread = yield* fixture.threads.insert({
        ownerId: 'owner',
        agentId: 'agent',
        history: [said('a'), said('b'), said('c'), said('d')],
      });
      const compact = (id: string, keepFrom: number, summary: string) =>
        fixture.fold(thread.id, (row, tx) =>
          Effect.gen(function* () {
            const event = yield* fixture.events.append(
              {
                threadId: thread.id,
                id: `${thread.id}-${id}`,
                kind: 'compaction',
                payload: { compacted: { keepFrom, messages: [said(summary)] } },
              },
              tx,
            );
            return {
              history: [said(summary), ...row.history.slice(keepFrom)],
              covered: { from: event.position - 1, through: event.position },
            };
          }),
        );

      yield* compact('compaction-1', 2, 'summary one');
      expect(yield* fixture.threads.historyOf(thread.id)).toEqual([said('summary one'), said('c'), said('d')]);

      yield* compact('compaction-2', 2, 'summary two');
      expect(yield* fixture.threads.historyOf(thread.id)).toEqual([said('summary two'), said('d')]);
      expect((yield* rowsOf(fixture, thread.id)).map((row) => [row.ord, row.message])).toEqual([
        [0, said('summary two')],
        [1, said('d')],
      ]);
      expect(yield* cursorOf(fixture, thread.id)).toBe(2);
    }),
  );

  it.effect('a context read over an unmaterialized suffix stores every message it carried', () =>
    Effect.gen(function* () {
      const fixture = yield* stand;
      const thread = yield* fixture.threads.insert({ ownerId: 'owner', agentId: 'agent' });
      yield* fixture.threads.transaction((tx) => Effect.forEach([0, 1], (index) => fixture.events.append(spoken(thread.id, index), tx)));
      expect(yield* rowsOf(fixture, thread.id)).toEqual([]);
      expect(yield* fixture.threads.historyOf(thread.id)).toEqual([said('line 0'), said('line 1')]);

      yield* write(fixture, thread, (held) => [...held, said('after')]);

      expect(yield* fixture.threads.historyOf(thread.id)).toEqual([said('line 0'), said('line 1'), said('after')]);
      expect((yield* rowsOf(fixture, thread.id)).map((row) => [row.ord, row.message])).toEqual([
        [0, said('line 0')],
        [1, said('line 1')],
        [2, said('after')],
      ]);
      expect(yield* cursorOf(fixture, thread.id)).toBe(2);
    }),
  );

  it.effect('a history read never doubles or drops a message a concurrent append commits under it', () =>
    Effect.gen(function* () {
      const fixture = yield* stand;
      const thread = yield* fixture.threads.insert({ ownerId: 'owner', agentId: 'agent', history: [said('born')] });
      const rounds = 2;
      const canonical = ['born', ...Array.from({ length: rounds }, (_unused, at) => `line ${at}`)];

      const seen: (readonly Message[] | null)[] = [];
      for (let at = 0; at < rounds; at += 1) {
        yield* fixture.threads.transaction((tx) => fixture.events.append(spoken(thread.id, at), tx));
        const [, observed] = yield* Effect.all(
          [
            fixture.fold(thread.id, (row) => Effect.succeed({ history: [...row.history] })),
            Effect.forEach([0, 1], () => fixture.threads.historyOf(thread.id), { concurrency: 2 }),
          ],
          { concurrency: 'unbounded' },
        );
        seen.push(...observed);
      }

      for (const history of seen) {
        const texts = (history ?? []).map(spoke);
        expect(texts).toEqual(canonical.slice(0, texts.length));
      }
      expect(yield* fixture.threads.historyOf(thread.id)).toHaveLength(rounds + 1);
      expect((yield* rowsOf(fixture, thread.id)).map((row) => row.ord)).toEqual(Array.from({ length: rounds + 1 }, (_unused, at) => at));
    }),
  );

  it.effect('an empty context reads as empty, and a thread that is not there reads as nothing', () =>
    Effect.gen(function* () {
      const fixture = yield* stand;
      const silent = yield* fixture.threads.insert({ ownerId: 'owner', agentId: 'agent' });

      expect(yield* fixture.threads.historyOf(silent.id)).toEqual([]);
      expect(yield* rowsOf(fixture, silent.id)).toEqual([]);
      expect(yield* fixture.threads.historyOf('01a00000-0000-7000-8000-000000000000')).toBeNull();
      yield* write(fixture, silent, (held) => [...held, said('first')]);
      expect(yield* fixture.threads.historyOf(silent.id)).toEqual([said('first')]);
    }),
  );

  it.effect('a thread born with a context seeds its own rows and shares none', () =>
    Effect.gen(function* () {
      const fixture = yield* stand;
      const first = yield* fixture.threads.insert({ ownerId: 'owner', agentId: 'agent', history: [said('one'), said('two')] });
      const second = yield* fixture.threads.insert({ ownerId: 'owner', agentId: 'agent', history: [said('other')] });

      expect((yield* rowsOf(fixture, first.id)).map((row) => row.message)).toEqual([said('one'), said('two')]);
      expect((yield* rowsOf(fixture, second.id)).map((row) => row.message)).toEqual([said('other')]);

      yield* fixture.threads.delete([first.id]);
      expect(yield* rowsOf(fixture, first.id)).toEqual([]);
      expect((yield* rowsOf(fixture, second.id)).map((row) => row.message)).toEqual([said('other')]);
    }),
  );
});
