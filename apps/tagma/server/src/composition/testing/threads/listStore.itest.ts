import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import type { Cursor } from '@runlith/paging';
import { THREAD_RUN_AWAITING_QUESTION_STAGE } from '@runlith/agent/thread/storage/runs';
import { THREAD_TOOL_CONFIRM_KIND } from '@runlith/agent/transcript/parts';
import type { ThreadQuestionEntry } from '@runlith/agent/transcript/entries';
import { eq, sql } from 'drizzle-orm';
import { Clock, Effect, Queue } from 'effect';
import { ExecutionId, InstallationId, type ExecutionRef } from '@runlith/executions/protocol/execution';
import { COMMAND_RESULT_SIGNAL, commandSignalId } from '../../../executions/contract/wire/commands.js';
import { CommandWaiters } from '../../../executions/contract/service/commands.js';
import { commandNoticeQueue } from '../../../executions/testing/doubles.js';
import { storesOver } from '../../../executions/testing/stores.js';
import { ThreadId } from '../../../platform/contract/wire/thread.js';
import { ownWork, standingOfSummary, threadInbox, threadListReads } from '../../../threads/testing/doubles.js';
import { externalSession, thread, threadRun, unmeasuredObservation } from '../../../threads/testing/doubles.js';
import { harnessPresentation } from '../../../external-harnesses/contract/service/table.js';
import { transcript } from './transcript.js';
import { saidOfRuns } from '../../../threads/list/said.js';
import { threadSeen } from '../../../threads/testing/doubles.js';
import { SCOPED_RUN, threadRunStore } from '../../../native-harness/testing/doubles.js';
import { shelveRecord } from '../../../thread-record/testing/records.js';
import { restFor } from '../../../threads/testing/rest.js';
import { assignmentSelection } from '../../../workspace/testing/doubles.js';
import { type ThreadStoreFixture, threadStoreFixture } from '../threadStoreFixture.js';
import { threadDirectoryStore } from '../../../threads/testing/doubles.js';
import { nativeAsk } from '../../../threads/testing/doubles.js';

import { threadParts, type ThreadParts } from '../threadParts.js';
import { writes } from '../../../platform/contract/service/writes.js';
import type { ThreadRecords } from '../../../thread-record/contract/service/records.js';
import { threadRecord } from '../../../thread-record/testing/doubles.js';
import { ENTRY_KINDS } from '../../manifest.js';

const titleIdentity = (records: ThreadRecords['Service'], id: string) =>
  Effect.map(records.facts(id), (facts) =>
    facts === undefined ? undefined : { title: facts.title, origin: facts.titleProvenance, revision: facts.titleRevision },
  );

it.live(
  'the newest cut run is the thread list outcome',
  Effect.fnUntraced(function* () {
    const demo = yield* threadStoreFixture;
    const { records, store, threads } = demo;
    yield* demo.units
      .write('ThreadStore', (unit) =>
        Effect.gen(function* () {
          const created = yield* store.insert({ ownerId: 'operator', agentId: 'tagma' }, unit);
          yield* threads.rows.attachFacet({ threadId: created.id, projectId: demo.projectId }, unit);
          yield* unit.run(
            demo.db.insert(threadRun()).values([
              {
                id: '0001',
                threadId: created.id,
                ownerId: 'old-owner',
                status: 'completed',
                finishedAt: new Date('2026-01-01T00:00:00.000Z'),
              },
              {
                id: '0002',
                threadId: created.id,
                ownerId: 'dead-owner',
                status: 'cut',
                finishedAt: new Date('2026-01-02T00:00:00.000Z'),
              },
            ]),
          );
        }),
      )
      .pipe(Effect.orDie);
    const { rows } = yield* threads.list
      .list('operator', { id: demo.projectId, projects: [demo.projectId] }, { view: 'live' })
      .pipe(Effect.orDie);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toMatchObject({ runId: '0002', status: 'cut' });
  }),
);

it.live(
  'a title term selects a thread by its title or by its team name',
  Effect.fnUntraced(function* () {
    const demo = yield* threadStoreFixture;
    const { records, store, threads } = demo;
    const [named, titled] = yield* demo.units
      .write('ThreadStore', (unit) =>
        Effect.gen(function* () {
          const made: string[] = [];
          for (const [name, title] of [
            ['build-code-facts', 'tagma'],
            [null, 'code-facts audit'],
          ] as const) {
            const created = yield* store.insert({ ownerId: 'operator', agentId: 'tagma', name }, unit);
            yield* threads.rows.attachFacet({ threadId: created.id, projectId: demo.projectId, title }, unit);
            made.push(created.id);
          }
          return made as [string, string];
        }),
      )
      .pipe(Effect.orDie);
    const selected = Effect.fnUntraced(function* (title: string) {
      const page = yield* threads.list
        .list('operator', { id: demo.projectId, projects: [demo.projectId] }, { view: 'live', title })
        .pipe(Effect.orDie);
      return { ids: page.rows.map((row) => row.id).sort(), total: page.total };
    });
    expect(yield* selected('build-code')).toEqual({ ids: [named], total: 1 });
    expect(yield* selected('audit')).toEqual({ ids: [titled], total: 1 });
    expect(yield* selected('code-facts')).toEqual({ ids: [named, titled].sort(), total: 2 });
  }),
);

it.live(
  'list and summary rows carry metadata without the prompt texts',
  Effect.fnUntraced(function* () {
    const demo = yield* threadStoreFixture;
    const { records, store, threads } = demo;
    const id = yield* demo.units
      .write('ThreadStore.id', (unit) =>
        Effect.gen(function* () {
          const created = yield* store.insert(
            { ownerId: 'operator', agentId: 'tagma', systemPrompt: 'frozen', pendingSystemPrompt: 'pending' },
            unit,
          );
          yield* threads.rows.attachFacet({ threadId: created.id, projectId: demo.projectId }, unit);
          return created.id;
        }),
      )
      .pipe(Effect.orDie);
    const { rows } = yield* threads.list
      .list('operator', { id: demo.projectId, projects: [demo.projectId] }, { view: 'live' })
      .pipe(Effect.orDie);
    const one = yield* threads.list.summary(id).pipe(Effect.orDie);
    const stored = yield* store.systemPromptOf(id).pipe(Effect.orDie);
    expect(stored).toMatchObject({ systemPrompt: 'frozen', pendingSystemPrompt: 'pending' });
    expect(rows).toHaveLength(1);
    for (const row of [...rows, one]) {
      expect(row?.id).toBe(id);
      expect(row !== undefined && 'systemPrompt' in row).toBe(false);
      expect(row !== undefined && 'pendingSystemPrompt' in row).toBe(false);
    }
  }),
);

const project = Effect.fnUntraced(function* (demo: ThreadStoreFixture, count: number) {
  const { records, store, threads } = demo;
  const ids = yield* demo.units
    .write('ThreadStore.ids', (unit) =>
      Effect.gen(function* () {
        const made: string[] = [];
        for (let index = 0; index < count; index += 1) {
          const created = yield* store.insert({ ownerId: 'operator', agentId: 'tagma' }, unit);
          yield* threads.rows.attachFacet({ threadId: created.id, projectId: demo.projectId }, unit);
          yield* unit.run(shelveRecord(demo.db, created.id, { readerOrderAt: new Date(Date.UTC(2026, 0, 1 + index)) }));
          made.push(created.id);
        }
        return made;
      }),
    )
    .pipe(Effect.orDie);
  return { store, threads, records, ids };
});

const progress = { stage: null, message: null } as const;

function runs(demo: ThreadStoreFixture, threads: ThreadParts, records: ThreadRecords['Service'], ownerId: string) {
  return Effect.provide(
    threadRunStore({
      kinds: ENTRY_KINDS,
      records,
      ownerId,
      scope: SCOPED_RUN(),
      lifecycle: {
        started: (threadId, at, tx) => threads.spells.begin(threadId, at, tx),
        settled: (threadId, tx) => threads.spells.end(threadId, tx),
      },
    }),
    demo.context,
  );
}

type RunStore = Effect.Success<ReturnType<typeof threadRunStore>>;

const start = (store: RunStore, threadId: string) =>
  store
    .createRun({
      startFrom: {
        id: threadId,
        ownerId: 'operator',
        account: null,
        provider: 'openai-oauth',
        model: 'test',
        reasoning: null,
        switches: {},
      },
      kind: 'turn',
      approval: { mode: 'trust', interactive: false },
      progress,
    })
    .pipe(
      Effect.map((started) => started.run),
      Effect.orDie,
    );

const settle = (store: RunStore, runId: string, at: Date) =>
  store
    .settleRun(runId, {
      status: 'completed',
      progress,
      finishedAt: at,
      heartbeatAt: at,
    })
    .pipe(Effect.orDie);

it.live(
  'a pinned root rides the window however old its reader clock is',
  Effect.fnUntraced(function* () {
    const demo = yield* threadStoreFixture;
    const { threads, ids } = yield* project(demo, 3);
    const [oldest, middle, newest] = ids as [string, string, string];
    yield* threads.list.setPinned(oldest, new Date('2026-02-01T00:00:00.000Z')).pipe(Effect.orDie);
    const window = yield* threads.list.rootWindow('operator', [demo.projectId], { limit: 1 }).pipe(Effect.orDie);
    const admitted = window.rows.map((row) => row.id);
    expect(admitted).toContain(oldest);
    expect(admitted).toContain(newest);
    expect(admitted).not.toContain(middle);
    expect(window.roots).toBe(3);
  }),
);

it.live(
  'an old root rides the window while a sub-agent under it is pinned, and falls back out once the pin is released',
  Effect.fnUntraced(function* () {
    const demo = yield* threadStoreFixture;
    const { store, threads, ids } = yield* project(demo, 3);
    const [oldest, middle, newest] = ids as [string, string, string];
    const child = yield* demo.units
      .write('ThreadStore.child', (unit) =>
        Effect.gen(function* () {
          const born = yield* store.insertChild(oldest, { ownerId: 'operator', agentId: 'tagma' }, unit);
          yield* threads.rows.inheritFacet({ threadId: born.id, fromThreadId: oldest, agentId: 'tagma' }, unit);
          return born.id;
        }),
      )
      .pipe(Effect.orDie);
    const admitted = Effect.map(threads.list.rootWindow('operator', [demo.projectId], { limit: 1 }).pipe(Effect.orDie), (window) =>
      window.rows.map((row) => row.id),
    );
    yield* threads.list.setPinned(child, new Date('2026-02-01T00:00:00.000Z')).pipe(Effect.orDie);
    expect(yield* admitted).toEqual(expect.arrayContaining([oldest, child, newest]));
    expect(yield* admitted).not.toContain(middle);
    yield* threads.list.setPinned(child, null).pipe(Effect.orDie);
    expect(yield* admitted).not.toContain(oldest);
  }),
);

it.live(
  'a second pin keeps the place the first one earned',
  Effect.fnUntraced(function* () {
    const demo = yield* threadStoreFixture;
    const { threads, ids } = yield* project(demo, 1);
    const [only] = ids as [string];
    const first = new Date('2026-02-01T00:00:00.000Z');
    yield* threads.list.setPinned(only, first).pipe(Effect.orDie);
    yield* threads.list.setPinned(only, new Date('2026-03-01T00:00:00.000Z')).pipe(Effect.orDie);
    const held = yield* threads.list.summary(only).pipe(Effect.orDie);
    expect(held?.pinnedAt).toEqual(first);
    yield* threads.list.setPinned(only, null).pipe(Effect.orDie);
    expect((yield* threads.list.summary(only).pipe(Effect.orDie))?.pinnedAt).toBeNull();
  }),
);

it.live(
  'a pin named inside a tree lands on that thread and leaves its root loose',
  Effect.fnUntraced(function* () {
    const demo = yield* threadStoreFixture;
    const { store, threads, ids } = yield* project(demo, 1);
    const [root] = ids as [string];
    const child = yield* demo.units
      .write('ThreadStore.child', (unit) =>
        Effect.gen(function* () {
          const born = yield* store.insertChild(root, { ownerId: 'operator', agentId: 'tagma' }, unit);
          yield* threads.rows.inheritFacet({ threadId: born.id, fromThreadId: root, agentId: 'tagma' }, unit);
          return born.id;
        }),
      )
      .pipe(Effect.orDie);
    const held = yield* threads.list.setPinned(child, new Date('2026-02-01T00:00:00.000Z')).pipe(Effect.orDie);
    expect<string | undefined>(held).toBe(child);
    expect((yield* threads.list.summary(child).pipe(Effect.orDie))?.pinnedAt).not.toBeNull();
    expect((yield* threads.list.summary(root).pipe(Effect.orDie))?.pinnedAt).toBeNull();
  }),
);

it.live(
  'a birth answers the project the child was born into',
  Effect.fnUntraced(function* () {
    const demo = yield* threadStoreFixture;
    const { store, threads, ids } = yield* project(demo, 1);
    const [root] = ids as [string];
    const [inherited, orphaned] = yield* Effect.acquireRelease(
      demo.units.write('ThreadStore', (unit) =>
        Effect.gen(function* () {
          const born = yield* store.insertChild(root, { ownerId: 'operator', agentId: 'tagma' }, unit);
          const answered = yield* threads.rows.inheritFacet({ threadId: born.id, fromThreadId: root, agentId: 'tagma' }, unit);
          const nobody = yield* store.insert({ ownerId: 'operator', agentId: 'tagma' }, unit);
          const none = yield* threads.rows.inheritFacet({ threadId: nobody.id, fromThreadId: nobody.id, agentId: 'tagma' }, unit);
          return [answered, none, nobody.id] as const;
        }),
      ),
      ([, , threadId]) => store.delete([threadId]).pipe(Effect.orDie),
    ).pipe(Effect.orDie);
    expect(inherited).toBe(demo.projectId);
    expect(orphaned).toBeUndefined();
  }),
);

it.live(
  "a child's run keeps the tree spell through its parent's settlement and a store reload",
  Effect.fnUntraced(function* () {
    const demo = yield* threadStoreFixture;
    const { store, threads, records, ids } = yield* project(demo, 1);
    const [root] = ids as [string];
    const child = yield* demo.units
      .write('ThreadStore.child', (unit) =>
        Effect.gen(function* () {
          const born = yield* store.insertChild(root, { ownerId: 'operator', agentId: 'tagma' }, unit);
          yield* threads.rows.inheritFacet({ threadId: born.id, fromThreadId: root, agentId: 'tagma' }, unit);
          return born.id;
        }),
      )
      .pipe(Effect.orDie);
    const owner = yield* runs(demo, threads, records, 'first-owner');
    const rootRun = yield* start(owner, root);
    const childRun = yield* start(owner, child);
    const spell = rootRun.startedAt;
    expect((yield* threads.list.summary(child).pipe(Effect.orDie))?.liveSpellStartedAt).toEqual(spell);
    yield* settle(owner, rootRun.id, new Date('2026-02-01T00:00:00.000Z'));
    const reloaded = yield* Effect.provide(
      threadParts({
        db: demo.db,
        units: demo.units,
        threads: store,
        records,
      }),
      demo.context,
    );
    expect((yield* reloaded.list.summary(root).pipe(Effect.orDie))?.liveSpellStartedAt).toEqual(spell);
    expect((yield* reloaded.list.summary(child).pipe(Effect.orDie))?.liveSpellStartedAt).toEqual(spell);
    yield* settle(owner, childRun.id, new Date('2026-02-01T00:01:00.000Z'));
  }),
);

it.live(
  'adoption keeps the spell, and the final settlement clears it',
  Effect.fnUntraced(function* () {
    const demo = yield* threadStoreFixture;
    const { threads, records, ids } = yield* project(demo, 1);
    const [root] = ids as [string];
    const first = yield* runs(demo, threads, records, 'first-owner');
    const run = yield* start(first, root);
    const spell = run.startedAt;
    yield* first.handOverRuns([run.id], new Date('2026-02-01T00:00:00.000Z')).pipe(Effect.orDie);
    const successor = yield* runs(demo, threads, records, 'successor-owner');
    const adopted = yield* successor
      .adoptRun(run.id, {
        selector: { kind: 'handed-over' },
        maxResumes: 3,
        progress,
        heartbeatAt: new Date('2026-02-01T00:00:01.000Z'),
      })
      .pipe(Effect.orDie);
    expect(adopted?.ownerId).toBe('successor-owner');
    expect((yield* threads.list.summary(root).pipe(Effect.orDie))?.liveSpellStartedAt).toEqual(spell);
    yield* settle(successor, run.id, new Date('2026-02-01T00:01:00.000Z'));
    expect((yield* threads.list.summary(root).pipe(Effect.orDie))?.liveSpellStartedAt).toBeNull();
  }),
);

it.live(
  'a whole-conversation branch inherits the source cursors; a fresh child and a cut branch start at zero; only branches name their source',
  Effect.fnUntraced(function* () {
    const demo = yield* threadStoreFixture;
    const { store, threads, ids } = yield* project(demo, 1);
    const [source] = ids as [string];
    yield* Effect.all([
      threads.rows.advanceGraphCursor(source, { eventId: 41 }),
      threads.rows.advanceWorldState(source, { snapshot: { skills: ['a', 'b'] }, checkpointId: 'ckpt-1', contextRuns: ['run-1'] }),
    ]).pipe(Effect.orDie);
    const born = (carried: 'all' | 'turns' | 'fresh') =>
      demo.units
        .write('ThreadStore.born', (unit) =>
          Effect.gen(function* () {
            const row = yield* store.insert({ ownerId: 'operator', agentId: 'tagma', cacheGroup: source }, unit);
            yield* threads.rows.inheritFacet({ threadId: row.id, fromThreadId: source, agentId: 'tagma', carried }, unit);
            return row.id;
          }),
        )
        .pipe(Effect.orDie);
    const told = Effect.fnUntraced(function* (id: string) {
      return {
        cursor: yield* threads.rows.graphCursor(id).pipe(Effect.orDie),
        world: yield* threads.rows.worldStateSnapshot(id).pipe(Effect.orDie),
      };
    });
    const whole = yield* told(yield* born('all'));
    expect(whole.cursor).toMatchObject({ eventId: 41 });
    expect(whole.world).toMatchObject({
      snapshot: { skills: ['a', 'b'] },
      checkpointId: 'ckpt-1',
      contextRuns: ['run-1'],
      fork: { thread: source },
    });
    for (const carried of ['turns', 'fresh'] as const) {
      const again = yield* told(yield* born(carried));
      expect(again.cursor).toMatchObject({ eventId: 0 });
      expect(again.world).toMatchObject({ snapshot: {}, checkpointId: null, contextRuns: null });
      expect(again.world.fork?.thread ?? null).toBe(carried === 'turns' ? source : null);
    }
  }),
);

it.live(
  'a shown draft name lands random, an operator title lands manual',
  Effect.fnUntraced(function* () {
    const demo = yield* threadStoreFixture;
    const { records, store, threads } = demo;
    const born = (values: { name?: string; title?: string }) =>
      demo.units
        .write('ThreadStore.born', (unit) =>
          Effect.gen(function* () {
            const created = yield* store.insert({ ownerId: 'operator', agentId: 'tagma' }, unit);
            yield* threads.rows.attachFacet({ threadId: created.id, projectId: demo.projectId, ...values }, unit);
            return created.id;
          }),
        )
        .pipe(Effect.orDie);
    const shown = yield* born({ name: 'kind-otter' });
    expect(yield* titleIdentity(records, shown).pipe(Effect.orDie)).toMatchObject({
      title: 'kind-otter',
      origin: 'random',
    });
    const named = yield* born({ title: 'Mine' });
    expect(yield* titleIdentity(records, named).pipe(Effect.orDie)).toMatchObject({
      title: 'Mine',
      origin: 'manual',
    });
  }),
);

it.live(
  'a branch wears its source name inside fork (…) unless it was given a title; a spawned child wears its address',
  Effect.fnUntraced(function* () {
    const demo = yield* threadStoreFixture;
    const { store, threads, records, ids } = yield* project(demo, 1);
    const [root] = ids as [string];
    yield* demo.units
      .write(writes('ThreadStore.setTitle', [threadRecord()]), (unit) => records.setTitle(unit, root, 'quiet-harbor', 'manual'))
      .pipe(Effect.orDie);
    const [branch, spawned, titled] = yield* demo.units
      .write('ThreadStore', (unit) =>
        Effect.gen(function* () {
          const taken = yield* store.insert({ ownerId: 'operator', agentId: 'tagma' }, unit);
          yield* threads.rows.inheritFacet({ threadId: taken.id, fromThreadId: root, agentId: 'tagma', isRoot: true }, unit);
          const child = yield* store.insertChild(root, { ownerId: 'operator', agentId: 'tagma' }, unit);
          yield* threads.rows.inheritFacet({ threadId: child.id, fromThreadId: root, agentId: 'tagma' }, unit);
          const named = yield* store.insert({ ownerId: 'operator', agentId: 'tagma' }, unit);
          yield* threads.rows.inheritFacet(
            { threadId: named.id, fromThreadId: root, agentId: 'tagma', isRoot: true, title: 'Chosen title' },
            unit,
          );
          return [taken.id, child.id, named.id] as const;
        }),
      )
      .pipe(Effect.orDie);
    expect(yield* titleIdentity(records, titled).pipe(Effect.orDie)).toMatchObject({
      title: 'Chosen title',
      origin: 'manual',
    });
    expect(yield* titleIdentity(records, branch).pipe(Effect.orDie)).toMatchObject({
      title: 'fork (quiet-harbor)',
      origin: 'random',
    });
    expect(yield* titleIdentity(records, spawned).pipe(Effect.orDie)).toMatchObject({
      title: 'tagma',
      origin: 'agent',
    });
  }),
);

it.live(
  'the resting candidates exclude what is working, what is recent, and what already left',
  Effect.fnUntraced(function* () {
    const demo = yield* threadStoreFixture;
    const { records, store, threads } = demo;
    const long = new Date('2026-08-01T00:00:00.000Z');
    const boundary = new Date('2026-08-10T00:00:00.000Z');
    const recent = new Date('2026-08-20T00:00:00.000Z');
    const born = yield* demo.units
      .write('ThreadStore.born', (unit) =>
        Effect.gen(function* () {
          const made: Record<string, string> = {};
          for (const name of ['old', 'fresh', 'gone', 'busy']) {
            const row = yield* store.insert({ ownerId: 'operator', agentId: 'tagma' }, unit);
            yield* threads.rows.attachFacet({ threadId: row.id, projectId: demo.projectId }, unit);
            made[name] = row.id;
          }
          const child = yield* store.insertChild(made.busy as string, { ownerId: 'operator', agentId: 'tagma' }, unit);
          yield* threads.rows.inheritFacet({ threadId: child.id, fromThreadId: made.busy as string, agentId: 'tagma' }, unit);
          yield* unit.run(
            demo.db.insert(threadRun()).values({
              id: 'run-going',
              threadId: child.id,
              ownerId: 'operator',
              status: 'running',
            }),
          );
          return made;
        }),
      )
      .pipe(Effect.orDie);
    const db = demo.db;
    const stamp = Effect.fnUntraced(function* (threadId: string, values: { updatedAt: Date; projectionEvictedAt?: Date }) {
      yield* db.update(thread()).set({ updatedAt: values.updatedAt }).where(eq(thread().id, threadId));
      if (values.projectionEvictedAt !== undefined) yield* restFor(db, threadId, values.projectionEvictedAt);
    }, Effect.orDie);
    yield* stamp(born.old as string, { updatedAt: long });
    yield* stamp(born.fresh as string, { updatedAt: recent });
    yield* stamp(born.gone as string, { updatedAt: long, projectionEvictedAt: long });
    yield* stamp(born.busy as string, { updatedAt: long });
    expect(yield* threads.list.restingPast(demo.projectId, boundary).pipe(Effect.orDie)).toEqual([born.old as string]);
    expect(yield* threads.list.restingProjects().pipe(Effect.orDie)).toEqual([demo.projectId]);
  }),
);

const asked = (
  runId: string,
  prompts: readonly { readonly prompt: string; readonly kind?: string }[],
  tools: readonly string[],
  status: ThreadQuestionEntry['status'] = 'open',
): ThreadQuestionEntry => ({
  type: 'question',
  id: `entry-${runId}`,
  runId,
  questionId: `question-${runId}`,
  questions: prompts.map((prompt, index) => ({ id: `call-${index}`, toolCallId: `call-${index}`, ...prompt })),
  toolCalls: tools.map((toolName, index) => ({ toolCallId: `call-${index}`, toolName })),
  status,
  occurredAt: '2026-09-24T01:00:00.000Z',
});

const confirm = (prompt: string) => ({ prompt, kind: THREAD_TOOL_CONFIRM_KIND });

const park = Effect.fnUntraced(function* (
  demo: ThreadStoreFixture,
  threadId: string,
  pending: unknown,
  run: { readonly id: string; readonly waiting: boolean } | null = { id: (pending as { runId: string }).runId, waiting: true },
) {
  const db = demo.db;
  yield* Effect.gen(function* () {
    yield* db
      .update(thread())
      .set({ pendingInteraction: pending as ThreadQuestionEntry })
      .where(eq(thread().id, threadId));
    if (run === null) return;
    yield* db.insert(threadRun()).values({
      id: run.id,
      threadId,
      ownerId: 'operator',
      status: 'running',
      startedAt: new Date(yield* Clock.currentTimeMillis),
      heartbeatAt: new Date(yield* Clock.currentTimeMillis),
      progress: run.waiting ? { stage: THREAD_RUN_AWAITING_QUESTION_STAGE, message: null } : progress,
    });
  }).pipe(Effect.orDie);
});

it.live(
  'a native thread waiting on a question carries its ask, and the same words about the same tools share one key',
  Effect.fnUntraced(function* () {
    const demo = yield* threadStoreFixture;
    const { threads, ids } = yield* project(demo, 24);
    const [otherTool, freeQuestion, mixed, answered, broken, otherWords, pair, pairTurned, stopped, earlier, long, idle, ...same] = ids as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      ...string[],
    ];
    for (const [index, id] of same.entries()) {
      yield* park(demo, id, asked(`run-${index}`, [confirm(index % 2 === 0 ? 'Run `git push`' : ' Run\n `git   push` ')], ['bash']));
    }
    yield* park(demo, otherTool, asked('run-write', [confirm('Run `git push`')], ['write']));
    yield* park(demo, freeQuestion, asked('run-free', [{ prompt: 'Run `git push`' }], ['bash']));
    yield* park(demo, mixed, asked('run-mixed', [confirm('Run `git push`'), { prompt: 'Which remote?' }], ['bash', 'ask']));
    yield* park(demo, answered, asked('run-answered', [confirm('Run `git push`')], ['bash'], 'answered'));
    yield* park(demo, broken, { type: 'question', runId: 'run-broken', questions: 'not a list' });
    yield* park(demo, otherWords, asked('run-other-words', [confirm('Run `git pull`')], ['bash']));
    yield* park(demo, pair, asked('run-pair', [confirm('Run both'), confirm('Run both')], ['bash', 'read']));
    yield* park(demo, pairTurned, asked('run-pair-turned', [confirm('Run both'), confirm('Run both')], ['read', 'bash']));
    yield* park(demo, stopped, asked('run-stopped', [confirm('Run `git push`')], ['bash']), { id: 'run-stopped', waiting: false });
    yield* park(demo, earlier, asked('run-earlier', [confirm('Run `git push`')], ['bash']), { id: 'run-later', waiting: true });
    yield* park(demo, long, asked('run-long', [confirm(`Run \`${'x'.repeat(5000)}\``)], ['bash']));
    yield* park(demo, idle, asked('run-idle', [confirm('Run `git push`')], ['bash']), null);
    const { rows } = yield* threads.list
      .list('operator', { id: demo.projectId, projects: [demo.projectId] }, { view: 'live' })
      .pipe(Effect.orDie);
    const ask = (id: string) => rows.find((row) => row.id === id)?.ask;
    expect(rows).toHaveLength(24);
    expect(same).toHaveLength(12);
    expect(ask(same[0] as string)).toEqual({
      questionId: 'question-run-0',
      text: 'Run `git push`',
      kind: 'confirm',
      key: expect.any(String),
      askedAt: '2026-09-24T01:00:00.000Z',
      options: [],
    });
    const key = ask(same[0] as string)?.key;
    expect(new Set(same.map((id) => ask(id)?.key))).toEqual(new Set([key]));
    expect(ask(otherTool)?.kind).toBe('confirm');
    expect(ask(otherTool)?.key).not.toBe(key);
    expect(ask(freeQuestion)?.kind).toBe('question');
    expect(ask(freeQuestion)?.key).not.toBe(key);
    expect(ask(mixed)).toMatchObject({ kind: 'question', text: 'Run `git push`' });
    expect(ask(answered)).toBeNull();
    expect(ask(broken)).toBeNull();
    expect(ask(otherWords)?.key).not.toBe(key);
    expect(ask(pair)?.key).toBe(ask(pairTurned)?.key as string);
    expect(ask(stopped)).toBeNull();
    expect(ask(earlier)).toBeNull();
    expect(ask(idle)).toBeNull();
    expect([...(ask(long)?.text ?? '')].length).toBeLessThanOrEqual(1000);
    expect(ask(long)?.key).toEqual(expect.any(String));
    const directory = yield* Effect.provide(
      Effect.flatMap(threadDirectoryStore(ENTRY_KINDS), (held) =>
        held.list({ principal: 'operator', from: same[0] as string, limit: 200 }),
      ).pipe(Effect.orDie),
      demo.context,
    );
    const asking = (id: string) => directory.rows.find((row) => row.threadId === id)?.run?.askPrompt ?? null;
    for (const id of ids) expect(asking(id)).toBe(ask(id)?.text ?? null);
    expect(asking(same[0] as string)).toBe('Run `git push`');
  }),
);

it.live(
  'a row says the first line of its latest run: the answer after the last tool call, or the newest words while it runs',
  Effect.fnUntraced(function* () {
    const demo = yield* threadStoreFixture;
    const { threads, ids } = yield* project(demo, 10);
    const [answered, toolLast, going, long, failed, silent, misshapen, spaced, closing, malformed] = ids as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    yield* transcript(demo.db, answered, 'run-answered', 'completed', [
      { text: 'Let me look.' },
      { tool: true },
      { role: 'user', text: 'Also check the tests.' },
      { text: '\n  \nFound 3 issues\r\n\n1. The first one.' },
      { text: 'Noted, thanks.' },
    ]);
    yield* demo.db.update(threadRecord()).set({ harness: 'claude-code' }).where(eq(threadRecord().id, answered)).pipe(Effect.orDie);
    yield* demo.db
      .update(thread())
      .set({ transport: { adapter: 'acp', profile: 'claude-code', agent: null } })
      .where(eq(thread().id, answered))
      .pipe(Effect.orDie);
    yield* demo.db
      .insert(externalSession())
      .values({
        id: answered,
        facet: {
          name: 'claude-code',
          presentation: harnessPresentation('claude-code'),
          sessionKey: null,
          execution: null,
          observation: unmeasuredObservation(),
        },
      })
      .pipe(Effect.orDie);
    yield* transcript(demo.db, toolLast, 'run-tool-last', 'completed', [
      { text: 'Early words.' },
      { tool: true },
      { text: 'Later words.\nMore.' },
      { tool: true },
    ]);
    yield* transcript(demo.db, going, 'run-going', 'running', [
      { text: 'Reading the store.' },
      { tool: true },
      { text: '   ' },
      { text: 'Now the wire.\nnext' },
      { tool: true },
    ]);
    yield* transcript(demo.db, long, 'run-long', 'completed', [{ text: `${'word '.repeat(100)}\nsecond line` }]);
    yield* transcript(demo.db, failed, 'run-failed', 'failed', [{ text: 'Half an answer.' }]);
    yield* transcript(demo.db, silent, 'run-silent', 'running', [{ tool: true }]);
    yield* transcript(demo.db, misshapen, 'run-misshapen', 'running', [{ text: 'Standing words.' }, { text: 42 }, { text: null }]);
    yield* transcript(demo.db, spaced, 'run-spaced', 'completed', [{ text: `${'a'.repeat(160)} b` }]);
    yield* transcript(demo.db, closing, 'run-closing', 'completed', [
      { text: 'A' },
      { tool: true },
      { text: 'B' },
      { text: 'C' },
      { tool: true },
    ]);
    yield* transcript(demo.db, malformed, 'run-malformed', 'completed', [{ text: 'Before the tool.' }, { tool: true }]);
    yield* demo.db
      .run(sql`insert into thread_entry (thread_id, ord, entry_id, run_id, type, entry) values
                 (${malformed}, 2, 'torn', 'run-malformed', 'message', '{"type":"message","role":"assistant","text":"torn'),
                 (${malformed}, 3, 'after', 'run-malformed', 'message', '{"type":"message","id":"after","role":"assistant","text":"After it."}')`)
      .pipe(Effect.andThen(saidOfRuns(demo.db, malformed, ['run-malformed'])), Effect.orDie);
    const { rows } = yield* threads.list
      .list('operator', { id: demo.projectId, projects: [demo.projectId] }, { view: 'live' })
      .pipe(Effect.orDie);
    const said = (id: string) => rows.find((row) => row.id === id)?.saidLine;
    expect(said(answered)).toBe('Found 3 issues');
    expect(said(toolLast)).toBe('Later words.');
    expect(said(going)).toBe('Now the wire.');
    const cut = said(long) ?? '';
    expect([...cut].length).toBeLessThanOrEqual(160);
    expect(cut.endsWith('…')).toBe(true);
    expect('word '.repeat(100).startsWith(cut.slice(0, -1))).toBe(true);
    expect(said(failed)).toBeNull();
    expect(said(silent)).toBeNull();
    expect(said(misshapen)).toBe('Standing words.');
    expect([...(said(spaced) ?? '')].length).toBeLessThanOrEqual(160);
    expect(said(spaced)?.endsWith('…')).toBe(true);
    expect(said(closing)).toBe('B');
    expect(said(malformed)).toBeNull();
    expect(rows.find((row) => row.id === malformed)?.outcome?.status).toBe('completed');
    const window = yield* threads.list.rootWindow('operator', [demo.projectId], { limit: 50 }).pipe(Effect.orDie);
    expect(window.rows.find((row) => row.id === answered)?.saidLine).toBe('Found 3 issues');
    expect((yield* threads.list.summary(going).pipe(Effect.orDie))?.saidLine).toBe('Now the wire.');
  }),
);

it.live(
  'a standing says what each live thread is doing and where it was placed',
  Effect.fnUntraced(function* () {
    const demo = yield* threadStoreFixture;
    const { threads, ids } = yield* project(demo, 6);
    const [working, waiting, unseen, seen, idle, cleared] = ids as [string, string, string, string, string, string];
    const db = demo.db;
    yield* park(demo, waiting, null, { id: 'run-waiting', waiting: true });
    yield* Effect.gen(function* () {
      yield* db.insert(threadRun()).values([
        {
          id: 'run-working',
          threadId: working,
          ownerId: 'operator',
          status: 'running',
          startedAt: new Date(yield* Clock.currentTimeMillis),
          heartbeatAt: new Date(yield* Clock.currentTimeMillis),
          progress,
        },
        {
          id: 'run-unseen',
          threadId: unseen,
          ownerId: 'operator',
          status: 'completed',
          finishedAt: new Date(yield* Clock.currentTimeMillis),
        },
        { id: 'run-seen', threadId: seen, ownerId: 'operator', status: 'failed', finishedAt: new Date(yield* Clock.currentTimeMillis) },
      ]);
      yield* db.insert(threadSeen()).values({ threadId: seen, runId: 'run-seen' });
      yield* db.insert(assignmentSelection()).values({ threadId: cleared, rootId: null, provenance: 'cleared', revision: 1 });
      yield* shelveRecord(db, idle, { archivedAt: new Date(yield* Clock.currentTimeMillis) });
    }).pipe(Effect.orDie);
    const standings = yield* threads.list.standings(demo.projectId).pipe(Effect.orDie);
    const by = new Map(standings.map((one) => [one.threadId, one]));
    expect(by.get(working)?.state).toBe('working');
    expect(by.get(waiting)?.state).toBe('waiting');
    expect(by.get(unseen)?.state).toBe('finished');
    expect(by.get(seen)?.state).toBe('idle');
    expect(by.has(idle)).toBe(false);
    expect(by.get(cleared)).toMatchObject({ cleared: true, rootId: null, state: 'idle' });
    expect(by.get(working)).toMatchObject({ cleared: false, rootId: null });
    const named = yield* threads.list.standings(demo.projectId, [waiting, idle]).pipe(Effect.orDie);
    expect(named).toEqual(standings.filter((one) => one.threadId === waiting));
  }),
);

it.live(
  'the thread directory walks every row across cursor pages, none twice and none missed',
  Effect.fnUntraced(function* () {
    const demo = yield* threadStoreFixture;
    const { ids } = yield* project(demo, 5);
    const [working, awaiting, secondWorking] = ids as [string, string, string, ...string[]];
    yield* park(demo, working, null, { id: 'directory-working', waiting: false });
    yield* park(demo, awaiting, null, { id: 'directory-awaiting', waiting: true });
    yield* park(demo, secondWorking, null, { id: 'directory-second', waiting: false });
    yield* demo.db.update(thread()).set({ updatedAt: new Date('2026-01-01') });
    const expected = [[working, secondWorking].sort().reverse(), [awaiting], ids.slice(3).sort().reverse()].flat();
    const directory = yield* Effect.provide(threadDirectoryStore(ENTRY_KINDS), demo.context);
    const seen: string[] = [];
    let cursor: Cursor | null = null;
    const page = (after: Cursor | null) =>
      directory.list({ principal: 'operator', from: ids[0] as string, limit: 2, cursor: after ?? undefined }).pipe(Effect.orDie);
    let pages = 0;
    do {
      const read: Effect.Success<ReturnType<typeof page>> = yield* page(cursor);
      expect(read.total).toBe(5);
      seen.push(...read.rows.map((row) => row.threadId));
      cursor = read.cursor;
      pages += 1;
    } while (cursor !== null && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toEqual(expected);
  }),
);

it.live(
  'a running run reads the same on the list, the directory and the standings whichever transport the thread sits on',
  Effect.fnUntraced(function* () {
    const demo = yield* threadStoreFixture;
    const { threads, ids } = yield* project(demo, 6);
    const db = demo.db;
    const bindings = [
      { adapter: 'native', profile: null, agent: null },
      { adapter: 'acp', profile: 'devin', agent: null },
      { adapter: 'terminal', profile: 'claude-code', agent: null },
    ] as const;
    for (const [index, binding] of bindings.entries()) {
      yield* db
        .update(thread())
        .set({ transport: binding })
        .where(eq(thread().id, ids[index] as string))
        .pipe(Effect.orDie);
      yield* db
        .update(thread())
        .set({ transport: binding })
        .where(eq(thread().id, ids[index + 3] as string))
        .pipe(Effect.orDie);
      yield* park(demo, ids[index] as string, null, { id: `parity-working-${index}`, waiting: false });
      yield* park(demo, ids[index + 3] as string, null, { id: `parity-waiting-${index}`, waiting: true });
    }
    const directory = yield* Effect.provide(threadDirectoryStore(ENTRY_KINDS), demo.context);
    const read = yield* directory.list({ principal: 'operator', from: ids[0] as string, limit: 10 }).pipe(Effect.orDie);
    const standings = yield* threads.list.standings(demo.projectId).pipe(Effect.orDie);
    const shape = Effect.fnUntraced(function* (id: string) {
      const summary = yield* threads.list.summary(id).pipe(Effect.orDie);
      const row = read.rows.find((one) => one.threadId === id);
      return {
        life: summary?.life,
        active: summary?.activeRun !== null,
        asking: summary?.activeRun?.awaitingQuestion,
        assignment: row?.assignment,
        runLife: row?.run?.life,
        state: standings.find((one) => one.threadId === id)?.state,
      };
    });
    for (const index of [1, 2]) {
      expect(yield* shape(ids[index] as string)).toEqual(yield* shape(ids[0] as string));
      expect(yield* shape(ids[index + 3] as string)).toEqual(yield* shape(ids[3] as string));
    }
    expect(yield* shape(ids[0] as string)).toMatchObject({ active: true, assignment: 'running', runLife: 'working', state: 'working' });
    expect(yield* shape(ids[3] as string)).toMatchObject({ asking: true, runLife: 'awaiting', state: 'waiting' });
  }),
);

const owingReads = Effect.fnUntraced(function* (demo: ThreadStoreFixture, store: ThreadStoreFixture['store']) {
  const installation = InstallationId.make('list-owes');
  const deliveries = storesOver(demo.db, installation).deliveries;
  const waiters = yield* commandNoticeQueue({
    deliveries,
    ended: yield* Queue.unbounded<ExecutionRef>(),
    takeBack: Effect.die(new Error('the list takes back no notice')),
  }).pipe(Effect.provide(demo.context));
  const own = yield* ownWork().pipe(Effect.provideService(CommandWaiters, waiters), Effect.provide(demo.context));
  const reads = yield* Effect.provide(threadListReads(store, demo.records, ENTRY_KINDS, own), demo.context);
  const ended = Effect.fnUntraced(function* (threadId: string, runId: string) {
    yield* demo.db
      .insert(threadRun())
      .values({ id: runId, threadId, ownerId: 'operator', status: 'completed', finishedAt: new Date(yield* Clock.currentTimeMillis) })
      .pipe(Effect.orDie);
  });
  const owe = Effect.fnUntraced(function* (threadId: string, name: string) {
    const execution = { installation, execution: ExecutionId.make(`exec-${name}`), incarnation: 1 };
    const openedAt = yield* Clock.currentTimeMillis;
    yield* demo.units
      .write('listStore.owedCommand', (unit) =>
        deliveries.openDelivery(unit, { execution, thread: ThreadId.make(threadId), signalId: commandSignalId(execution, name), openedAt }),
      )
      .pipe(Effect.orDie);
    return execution;
  });
  const arrive = (threadId: string, execution: ExecutionRef, waits: boolean) =>
    demo.units
      .write('listStore.endArrives', (unit) =>
        Effect.andThen(
          deliveries.acceptDelivery(unit, execution),
          unit.run(
            demo.db.insert(threadInbox()).values({
              id: `signal:${execution.execution}`,
              threadId,
              sender: { kind: 'host' },
              kind: 'signal',
              body: { type: COMMAND_RESULT_SIGNAL, addressee: 'transport', text: 'exit 0', ...(waits ? { waits: true as const } : {}) },
              occurredAt: new Date(),
            }),
          ),
        ),
      )
      .pipe(Effect.orDie);
  const read = (threadId: string) =>
    demo.units
      .write('listStore.endRead', (unit) =>
        unit.run(demo.db.update(threadInbox()).set({ state: 'acknowledged' }).where(eq(threadInbox().threadId, threadId))),
      )
      .pipe(Effect.orDie);
  return { reads, ended, owe, arrive, read };
});

it.live(
  'a root between turns stays owed its own command end while the end runs and while it waits unread in the inbox, and stands as finished only once read',
  Effect.fnUntraced(function* () {
    const demo = yield* threadStoreFixture;
    const { store, ids } = yield* project(demo, 2);
    const [tester, stopped] = ids as [string, string];
    const world = yield* owingReads(demo, store);
    const standing = Effect.fnUntraced(function* (threadId: string) {
      const summary = yield* world.reads.summary(threadId).pipe(Effect.orDie);
      return { owes: summary?.owes, standing: summary === undefined ? undefined : (standingOfSummary(summary)?.kind ?? null) };
    });
    yield* world.ended(tester, 'run-owing');
    const suite = yield* world.owe(tester, 'call-e2e');
    expect(yield* standing(tester)).toEqual({ owes: true, standing: null });

    yield* world.arrive(tester, suite, false);
    expect(yield* standing(tester)).toEqual({ owes: true, standing: null });

    yield* world.read(tester);
    expect(yield* standing(tester)).toEqual({ owes: false, standing: 'finished' });

    yield* world.ended(stopped, 'run-stopped');
    yield* world.arrive(stopped, yield* world.owe(stopped, 'call-stopped'), true);
    expect((yield* standing(stopped)).owes).toBe(false);
  }),
);

it.live(
  'an old root whose grandchild is owed its own command end keeps its place in the opening window',
  Effect.fnUntraced(function* () {
    const demo = yield* threadStoreFixture;
    const { store, ids } = yield* project(demo, 2);
    const [old, newer] = ids as [string, string];
    const [middle, tester] = yield* demo.units
      .write('ThreadStore.children', (unit) =>
        Effect.gen(function* () {
          const made: string[] = [];
          let parent = old;
          for (const name of ['middle', 'tester']) {
            const created = yield* store.insertChild(parent, { ownerId: 'operator', agentId: 'tagma', name }, unit);
            yield* demo.threads.rows.inheritFacet({ threadId: created.id, fromThreadId: parent, agentId: 'tagma' }, unit);
            made.push(created.id);
            parent = created.id;
          }
          return made as [string, string];
        }),
      )
      .pipe(Effect.orDie);
    const world = yield* owingReads(demo, store);
    const window = () => world.reads.rootWindow('operator', [demo.projectId], { limit: 1 }).pipe(Effect.orDie);
    expect((yield* window()).rows.map((row) => row.id)).toEqual([newer]);

    yield* world.ended(tester, 'run-grandchild');
    yield* world.owe(tester, 'call-grandchild');
    const opened = yield* window();
    expect(opened.rows.map((row) => row.id).sort()).toEqual([old, newer, middle, tester].sort());
    expect(opened.rows.find((row) => row.id === tester)?.owes).toBe(true);
  }),
);
