import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { THREAD_RUN_AWAITING_QUESTION_STAGE } from '@runlith/agent/thread/storage/runs';
import { sql } from 'drizzle-orm';
import { Context, Effect, Layer, Schema } from 'effect';
import { THREAD_TOOL_CONFIRM_VALUE } from '@runlith/agent/transcript/parts';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { knownAnswer } from '../../../platform/contract/wire/operation.js';
import { ATTENTION_OPERATIONS } from '../../../threads/contract/wire/operations/attention.js';
import { threadWireSnapshotPayloadSchema } from '../../../threads/contract/wire/snapshot.js';
import { GRANT_HEADER, GRANT_VARIABLE } from '../../../platform/contract/service/credentials.js';
import { grantEnvironment } from '../../../platform/testing/grants.js';
import { testSessionIdentity } from '../../../platform/testing/identity.js';
import { DoorFixture, doorFixture, projectLeaving } from '../doorFixture.js';
import { turnsOf } from '../../../threads/testing/doubles.js';

const fixture = doorFixture();
const setup = Effect.fnUntraced(function* () {
  const world = yield* DoorFixture;
  const first = yield* world.plainProject();
  const second = yield* world.plainProject();
  yield* projectLeaving(world, first, second);
  return { world, first, second };
});

class World extends Context.Service<World, Effect.Success<ReturnType<typeof setup>>>()('testing/AttentionWorld') {}

const born = Effect.fnUntraced(function* (project: number, title: string, parent?: string) {
  const { world } = yield* World;
  const created = yield* world.op('create_thread', { title }, `project=${project}`);
  expect(created.status).toBe(200);
  const { thread } = (yield* Schema.decodeUnknownEffect(threadWireSnapshotPayloadSchema)(created.body)).snapshot;
  if (parent !== undefined) {
    const store = Context.get(world.runtime.graph, MachineStore);
    const units = Context.get(world.runtime.graph, MachineUnits);
    yield* units.write('attention.itest', (tx) =>
      tx.run(store.db.run(sql`update thread set parent_id = ${parent} where id = ${thread.id}`)),
    );
  }
  yield* Effect.addFinalizer(() => turnsOf(world.runtime.owners).delete(thread.id, project).pipe(Effect.orDie));
  return thread;
});

type RunSeed = {
  readonly id: string;
  readonly threadId: string;
  readonly ownerId: string;
  readonly status: string;
  readonly at: string;
  readonly progress?: unknown;
  readonly failure?: string;
};

const runs = Effect.fn('testing.attentionRuns')(function* (rows: readonly RunSeed[]) {
  const { world } = yield* World;
  const store = Context.get(world.runtime.graph, MachineStore);
  const units = Context.get(world.runtime.graph, MachineUnits);
  yield* Effect.addFinalizer(() =>
    units
      .write('attention.itest', (tx) =>
        Effect.forEach(
          rows,
          (row) =>
            tx.run(
              store.db.run(
                sql`update thread_run set status = 'cut', finished_at = ${Date.parse(row.at)} where id = ${row.id} and status = 'running'`,
              ),
            ),
          { discard: true },
        ),
      )
      .pipe(Effect.orDie),
  );
  yield* units.write('attention.itest', (tx) =>
    Effect.forEach(rows, (row) => {
      const at = Date.parse(row.at);
      const progress = JSON.stringify(row.progress ?? { stage: null, message: null });
      const finished = row.status === 'running' ? null : at;
      return Effect.gen(function* () {
        yield* tx.run(
          store.db.run(
            sql`insert into thread_run (id, thread_id, status, owner_id, finished_at, started_at, heartbeat_at, created_at, updated_at, progress, failure_reason) values (${row.id}, ${row.threadId}, ${row.status}, ${row.ownerId}, ${finished}, ${at}, ${at}, ${at}, ${at}, ${progress}, ${row.failure ?? null})`,
          ),
        );
        if (finished === null) return;
        yield* tx.run(
          store.db.run(
            sql`insert into thread_run_tally (thread_id, ended_runs, latest_run_id, latest_finished_at, unseen) values (${row.threadId}, 1, ${row.id}, ${finished}, 1) on conflict (thread_id) do update set ended_runs = ended_runs + 1, latest_run_id = excluded.latest_run_id, latest_finished_at = excluded.latest_finished_at, unseen = 1`,
          ),
        );
      });
    }),
  );
});

const asking = Effect.fnUntraced(function* (threadId: string, runId: string, prompt: string) {
  const { world } = yield* World;
  const store = Context.get(world.runtime.graph, MachineStore);
  const units = Context.get(world.runtime.graph, MachineUnits);
  const entry = {
    type: 'question',
    id: `entry-${runId}`,
    runId,
    questionId: `question-${runId}`,
    status: 'open',
    occurredAt: '2026-10-01T10:00:00.000Z',
    questions: [{ id: 'call-0', toolCallId: 'call-0', prompt }],
    toolCalls: [{ toolCallId: 'call-0', toolName: 'ask' }],
  };
  yield* units.write('attention.itest', (tx) =>
    tx.run(store.db.run(sql`update native_thread set pending_interaction = ${JSON.stringify(entry)} where id = ${threadId}`)),
  );
});

const decodeAttention = Schema.decodeUnknownEffect(knownAnswer(ATTENTION_OPERATIONS.read_attention.answer));
const read = Effect.fnUntraced(function* (input = { limit: 4 }, headers?: Readonly<Record<string, string>>) {
  const { world, first, second } = yield* World;
  const page = Effect.fnUntraced(function* (cursor?: string) {
    const answered = yield* world.op('read_attention', { ...input, cursor }, '', headers);
    expect(answered.status).toBe(200);
    const decoded = yield* decodeAttention(answered.body);
    expect(decoded.rows.length).toBeLessThanOrEqual(input.limit);
    return decoded;
  });
  let current = yield* page();
  const total = current.total;
  const rows = [...current.rows];
  while (current.cursor !== null) {
    current = yield* page(current.cursor);
    rows.push(...current.rows);
  }
  expect(rows).toHaveLength(total);
  return rows.filter((row) => row.project.id === first || row.project.id === second);
});

layer(Layer.effect(World, setup()).pipe(Layer.provide(fixture)), { excludeTestServices: true })('operator attention', (it) => {
  it.effect('read_attention lists what needs the operator across projects, and a seen run leaves the list', () =>
    Effect.gen(function* () {
      const { world, first, second } = yield* World;
      const asked = yield* born(first, 'asks a question');
      const failed = yield* born(second, 'run failed');
      const finished = yield* born(second, 'run finished');
      const child = yield* born(second, 'child finished', finished.id);
      yield* runs([
        {
          id: '019d0000-0000-7000-8000-000000000501',
          threadId: asked.id,
          ownerId: asked.ownerId,
          status: 'running',
          at: '2026-10-01T10:00:00.000Z',
          progress: { stage: THREAD_RUN_AWAITING_QUESTION_STAGE, message: null },
        },
        {
          id: '019d0000-0000-7000-8000-000000000502',
          threadId: failed.id,
          ownerId: failed.ownerId,
          status: 'failed',
          at: '2026-10-01T11:00:00.000Z',
          failure: 'provider refused',
        },
        {
          id: '019d0000-0000-7000-8000-000000000503',
          threadId: finished.id,
          ownerId: finished.ownerId,
          status: 'completed',
          at: '2026-10-01T12:00:00.000Z',
        },
        {
          id: '019d0000-0000-7000-8000-000000000504',
          threadId: child.id,
          ownerId: child.ownerId,
          status: 'completed',
          at: '2026-10-01T12:30:00.000Z',
        },
      ]);
      yield* asking(asked.id, '019d0000-0000-7000-8000-000000000501', 'Push to origin?');
      const everything = yield* read();
      expect(everything.map((row) => [row.threadId, row.kind, row.project.id])).toEqual([
        [finished.id, 'finished', second],
        [failed.id, 'failed', second],
        [asked.id, 'awaiting', first],
      ]);
      expect(everything[2]?.ask?.text).toBe('Push to origin?');
      expect(everything[1]?.failure?.ending).toBe('failed');
      const head = yield* world.op('read_attention', { limit: 2 });
      expect(head.status).toBe(200);
      const firstPage = yield* decodeAttention(head.body);
      expect(firstPage.rows).toHaveLength(2);
      expect(firstPage.cursor).not.toBeNull();
      expect(yield* read({ limit: 2 })).toEqual(everything);
      const reader = yield* born(second, 'the agent reading attention');
      const grant = grantEnvironment(reader.id, testSessionIdentity)[GRANT_VARIABLE] as string;
      expect(yield* read({ limit: 4 }, { [GRANT_HEADER]: grant })).toEqual(everything);
      expect(yield* read()).toEqual(everything);
      const marked = yield* world.op('mark_thread_seen', { threadId: finished.id, runId: everything[0]?.runId }, `project=${second}`);
      expect(marked.status).toBe(200);
      expect((yield* read()).map((row) => row.kind)).toEqual(['failed', 'awaiting']);
      expect(
        (yield* world.op('mark_thread_seen', { threadId: failed.id, runId: '019d0000-0000-7000-8000-000000000502' }, `project=${second}`))
          .status,
      ).toBe(200);
      expect((yield* read()).map((row) => row.threadId)).not.toContain(failed.id);
      const later = '019d0000-0000-7000-8000-000000000902';
      yield* runs([{ id: later, threadId: failed.id, ownerId: failed.ownerId, status: 'cut', at: '2026-10-01T12:45:00.000Z' }]);
      expect((yield* read()).find((row) => row.threadId === failed.id)).toMatchObject({ kind: 'failed', runId: later });
    }),
  );

  it.effect('a standing approval question shows in the list and Attention with no run going, and its answer takes it off', () =>
    Effect.gen(function* () {
      const { world, first: project } = yield* World;
      const thread = yield* born(project, 'approval');
      const questions = Context.get(world.runtime.owners, ThreadHarness).runs.questions();
      const request = {
        threadId: thread.id,
        key: 'exact-act',
        operation: 'finish_block',
        summary: 'Act on account-a',
        asked: ['review'],
        withinMs: null,
        waitMs: 10,
      };
      const asked = yield* questions.approve(request);
      if (asked.kind !== 'waiting') return yield* Effect.die(new Error(`Expected a standing question, got ${asked.kind}.`));
      expect((yield* read()).find((row) => row.threadId === thread.id)).toMatchObject({
        kind: 'awaiting',
        runId: null,
        ask: { text: 'Act on account-a' },
      });
      const listed = yield* world.op('list_threads', { ids: [thread.id], shape: 'rows' }, `project=${project}`);
      expect(listed).toMatchObject({ status: 200, body: { rows: [{ ask: { questionId: asked.questionId } }] } });
      yield* questions.answer(thread.id, asked.questionId, [{ questionId: asked.questionId, values: [THREAD_TOOL_CONFIRM_VALUE] }]);
      expect((yield* read()).find((row) => row.threadId === thread.id)).toBeUndefined();
      expect((yield* questions.approve(request)).kind).toBe('given');
    }),
  );
});
