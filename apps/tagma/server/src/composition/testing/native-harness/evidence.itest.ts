import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Clock, Context, Effect, FileSystem, Layer } from 'effect';
import { activity, note } from '@runlith/activity/Activity';
import { activityKind } from '@runlith/activity/fact';
import { ActivityLog } from '@runlith/activity/log';
import { ActivityStore } from '@runlith/activity/store';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { OPERATOR_PRINCIPAL } from '../../../platform/contract/wire/actor.js';
import { sqliteThreadJournal } from '../../../threads/testing/doubles.js';
import type { ExpandedRecord } from '../../../threads/contract/wire/evidence.js';
import { makeDoorWorld } from '../doorFixture.js';
import type { ServerRuntime } from '../../runtime.js';
import { asEvidenceAnswer, asExpandedRecord, asThreadShape, threadToolText } from '../../../threads/testing/doubles.js';
import { threadToolOutputStore } from '../../../native-harness/testing/doubles.js';

import { threadRun } from '../../../threads/testing/doubles.js';
import { shelveRecord } from '../../../thread-record/testing/records.js';
import { eq } from 'drizzle-orm';
import { evidenceQueriesOf } from '../../../threads/testing/doubles.js';
import { TOOL_OUTPUT_MAX_BYTES } from '@runlith/agent/ToolOutputSpool';
import { WIRE_ENTRY_MAX_BYTES } from '@runlith/agent/protocol/cap';
import { Message } from '@runlith/llm/schema/messages';

const makeEvidence = Effect.gen(function* () {
  const world = yield* makeDoorWorld();
  const projectId = yield* world.plainProject();
  const activity = yield* ActivityStore.pipe(Effect.provide(yield* world.runtime.runtime.contextEffect));
  return { world, runtime: world.runtime, call: world.call, projectId, activity };
});
class Evidence extends Context.Service<Evidence, Effect.Success<typeof makeEvidence>>()('test/Evidence') {}
const evidenceLayer = Layer.effect(Evidence, makeEvidence).pipe(Layer.provideMerge(BunFileSystem.layer));

const thread = Effect.fnUntraced(function* (projectId: number) {
  const { call } = yield* Evidence;
  const created = yield* call(`/api/op/create_thread?project=${projectId}`, { method: 'POST', body: {} });
  return (created.body as { snapshot: { thread: { id: string } } }).snapshot.thread.id;
});
const query = Effect.fnUntraced(function* (projectId: number, payload: Record<string, unknown>) {
  const { call } = yield* Evidence;
  const answered = yield* call(`/api/op/read_thread?project=${projectId}`, { method: 'POST', body: payload });
  return {
    status: answered.status,
    body: answered.body,
    answer: (answered.body as { evidence: ReturnType<typeof asEvidenceAnswer> }).evidence,
  };
});
const append = Effect.fnUntraced(function* (
  threadId: string,
  records: readonly { id: string; kind: string; payload: Record<string, unknown> }[],
) {
  const { runtime } = yield* Evidence;
  const log = yield* sqliteThreadJournal().pipe(Effect.provide(runtime.graph));
  yield* Context.get(runtime.graph, MachineUnits).write('evidence.append', (unit) =>
    Effect.forEach(records, (record) => log.append({ threadId, ...record }, unit), { discard: true }),
  );
});
const runsOn = Effect.fnUntraced(function* (threadId: string, count: number) {
  const { runtime } = yield* Evidence;
  const runs = Context.get(runtime.graph, MachineStore).db;
  const ids = Array.from({ length: count }, (_, index) => `${threadId}-run-${index}`);
  yield* Context.get(runtime.graph, MachineUnits).write('evidence.runsOn', (unit) =>
    unit.run(
      runs.insert(threadRun()).values(
        ids.map((id) => ({
          id,
          threadId,
          status: 'completed' as const,
          ownerId: OPERATOR_PRINCIPAL,
          provider: 'subscription',
          model: 'claude-opus-5-5',
          finishedAt: new Date('2026-09-06T10:00:00.000Z'),
        })),
      ),
    ),
  );
  return ids;
});
const readerClockOf = Effect.fnUntraced(function* (threadId: string, at: number) {
  const { runtime } = yield* Evidence;
  yield* shelveRecord(Context.get(runtime.graph, MachineStore).db, threadId, { readerOrderAt: new Date(at) });
});
const BODIES: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  'system-prompt': { text: 'You are the agent.' },
  message: { role: 'user', text: 'go' },
  tool: { toolName: 'read', toolCallId: 'call', toolState: 'output-available' },
};
const log = (threadId: string, kinds: readonly string[]) =>
  append(
    threadId,
    kinds.map((kind) => {
      const id = crypto.randomUUID();
      return { id, kind, payload: { entry: { type: kind, id, ...BODIES[kind] } } };
    }),
  );

layer(evidenceLayer, { excludeTestServices: true })('thread evidence', (it) => {
  it.effect('the shape opens a session without its log, and the log is queried as raw records', () =>
    Effect.gen(function* () {
      const { world, runtime, call, projectId } = yield* Evidence;
      const threadId = yield* thread(projectId);
      yield* log(threadId, ['system-prompt', 'message', 'tool', 'tool', 'message']);

      const shape = yield* call(`/api/op/read_thread?project=${projectId}`, { method: 'POST', body: { threadId } });
      expect(shape.status).toBe(200);
      const read = (shape.body as { shape: ReturnType<typeof asThreadShape> }).shape;
      expect(read.entries).toBe(5);
      expect(read.runs).toEqual([]);
      expect(read.thread.projectId).toBe(projectId);
      expect(read.acts).toEqual({ name: null, entries: 0, blocks: [], bounded: false });

      const first = yield* query(projectId, { select: 'records', threads: [threadId], limit: 3 });
      expect(first.status).toBe(200);
      expect(first.answer.rows.map((row) => row.at)).toEqual([1, 2, 3]);
      expect(Object.keys(first.answer.rows[0] ?? {}).sort()).toEqual(['at', 'id', 'kind', 'origin', 'threadId']);
      expect(first.answer.coverage.complete).toBe(false);
      expect(first.answer.cursor).not.toBeNull();

      const rest = yield* query(projectId, {
        select: 'records',
        threads: [threadId],
        limit: 3,
        cursor: first.answer.cursor,
      });
      expect(rest.answer.rows.map((row) => row.at)).toEqual([4, 5]);
      expect(rest.answer.threads).toEqual(first.answer.threads);
    }),
  );

  it.effect('a page answers at the head its reading pinned, whatever lands afterwards', () =>
    Effect.gen(function* () {
      const { world, runtime, call, projectId } = yield* Evidence;
      const threadId = yield* thread(projectId);
      yield* log(threadId, ['message', 'tool', 'message', 'tool']);

      const first = yield* query(projectId, { select: 'records', threads: [threadId], limit: 2 });
      expect(first.answer.rows.map((row) => row.at)).toEqual([1, 2]);
      expect(first.answer.threads[0]?.head).toBe(4);

      yield* log(threadId, ['tool', 'tool']);
      const rest = yield* query(projectId, {
        select: 'records',
        threads: [threadId],
        limit: 10,
        cursor: first.answer.cursor,
      });
      expect(rest.answer.rows.map((row) => row.at)).toEqual([3, 4]);
      expect(rest.answer.threads[0]?.head).toBe(4);
      expect(rest.answer.coverage.complete).toBe(true);

      const changed = yield* query(projectId, {
        select: 'entries',
        threads: [threadId],
        limit: 10,
        cursor: first.answer.cursor,
      });
      expect(changed.status).toBe(409);
      expect((changed.body as unknown as { code: string }).code).toBe('cursor-stale');
    }),
  );

  it.effect('a tool call is one logical entry however many transitions the log holds, and a withdrawal takes none of them away', () =>
    Effect.gen(function* () {
      const { world, runtime, call, projectId } = yield* Evidence;
      const threadId = yield* thread(projectId);
      const call_ = (state: string, id: string) => ({
        id,
        kind: 'tool',
        payload: {
          entry: {
            type: 'tool',
            id: 'tool:one',
            runId: 'run-1',
            toolCallId: 'one',
            toolName: 'edit',
            toolState: state,
            toolInput: { filePath: '/workspace/file.ts' },
          },
        },
      });
      yield* append(threadId, [
        call_('input-available', 'opened'),
        { id: 'said', kind: 'message', payload: { entry: { type: 'message', id: 'message-1', runId: 'run-1', role: 'user', text: 'go' } } },
        call_('output-error', 'settled'),
        { id: 'taken-back', kind: 'withdrawal', payload: { withdrawn: { runId: 'run-1', keepMessages: 0 } } },
      ]);

      const entries = yield* query(projectId, { select: 'entries', threads: [threadId], limit: 10 });
      expect(entries.answer.rows.map((row) => [row.identity, row.at, row.toolState])).toEqual([
        ['message-1', 2, null],
        ['tool:run-1:one', 3, 'output-error'],
      ]);
      expect(entries.answer.rows.some((row) => row.identity === 'message-1')).toBe(true);

      const records = yield* query(projectId, { select: 'records', threads: [threadId], limit: 10 });
      expect(records.answer.rows.map((row) => row.kind)).toEqual(['tool', 'message', 'tool', 'withdrawal']);

      const args = yield* query(projectId, {
        select: 'entries',
        threads: [threadId],
        limit: 10,
        where: [{ field: 'toolName', op: 'eq', value: 'edit' }],
        fields: ['at', 'entry.toolInput.filePath'],
      });
      expect(args.answer.rows).toEqual([{ threadId, at: 3, 'entry.toolInput.filePath': '/workspace/file.ts' }]);
    }),
  );

  it.effect('a step bill is counted once, per-attempt measurements stay their own, and the run ledger is a third figure', () =>
    Effect.gen(function* () {
      const { world, runtime, call, projectId } = yield* Evidence;
      const threadId = yield* thread(projectId);
      const context = (step: number) => ({
        runId: 'run-1',
        stepNumber: step,
        provider: 'subscription',
        model: 'claude-opus-5-5',
        contextWindow: 200_000,
        measuredAt: '2026-09-06T10:00:00.000Z',
      });
      const usage = { inputTokens: 100, outputTokens: 10, totalTokens: 110 };
      yield* append(threadId, [
        { id: 'step-0-messages', kind: 'step', payload: { messages: [], usage, context: context(0) } },
        { id: 'step-0-finished', kind: 'step-finished', payload: { context: context(0), usage } },
        {
          id: 'measured-0',
          kind: 'measurement',
          payload: {
            measurement: {
              runId: 'run-1',
              stepNumber: 0,
              attempt: 0,
              provider: 'subscription',
              model: 'claude-opus-5-5',
              usage,
              contextWindow: 200_000,
              inputLimit: null,
              footprint: { messages: 3, messageDigest: 'a', promptDigest: 'b', toolDigests: ['c'] },
              measuredAt: '2026-09-06T10:00:00.000Z',
            },
          },
        },
        {
          id: 'measured-0-retry',
          kind: 'measurement',
          payload: {
            measurement: {
              runId: 'run-1',
              stepNumber: 0,
              attempt: 1,
              provider: 'subscription',
              model: 'claude-opus-5-5',
              usage,
              contextWindow: 200_000,
              inputLimit: null,
              footprint: { messages: 3, messageDigest: 'a', promptDigest: 'b', toolDigests: ['c'] },
              measuredAt: '2026-09-06T10:00:01.000Z',
            },
          },
        },
      ]);

      const steps = yield* query(projectId, {
        select: 'steps',
        threads: [threadId],
        group: [],
        count: true,
        sum: ['usage.totalTokens'],
      });
      expect(steps.answer.groups).toEqual([{ by: {}, count: 1, sum: { 'usage.totalTokens': 110 } }]);
      expect(steps.answer.cursor).toBeNull();
      expect(steps.answer.coverage.complete).toBe(true);

      const attempts = yield* query(projectId, { select: 'measurements', threads: [threadId], limit: 10 });
      expect(attempts.answer.rows.map((row) => [row.stepNumber, row.attempt])).toEqual([
        [0, 0],
        [0, 1],
      ]);
    }),
  );

  it.effect('a stored defect stack survives a run reading and the thread shape wire', () =>
    Effect.gen(function* () {
      const { runtime, call, projectId } = yield* Evidence;
      const threadId = yield* thread(projectId);
      const id = (yield* runsOn(threadId, 1))[0]!;
      const failure = {
        provider: 'subscription',
        account: null,
        stage: 'thread',
        type: 'TypeError',
        retryable: null,
        modelStarted: null,
        stack: 'TypeError: projection broke\n    at project (runtime.ts:42:7)',
        record: { threadId, runId: id, entryId: `transcript:error:${id}` },
      };
      const db = Context.get(runtime.graph, MachineStore).db;
      yield* Context.get(runtime.graph, MachineUnits).write('evidence.failure', (unit) =>
        unit.run(
          db.update(threadRun()).set({ status: 'failed', failureReason: 'projection broke', failure }).where(eq(threadRun().id, id)),
        ),
      );
      const read = yield* query(projectId, { threadId, select: 'runs', fields: ['failure'], limit: 1 });
      expect(read.status).toBe(200);
      expect(read.answer.rows[0]?.failure).toEqual(failure);
      const shape = yield* call(`/api/op/read_thread?project=${projectId}`, { method: 'POST', body: { threadId } });
      expect(shape.status).toBe(200);
      expect((shape.body as { shape: ReturnType<typeof asThreadShape> }).shape.runs[0]?.failure).toEqual(failure);
    }),
  );

  it.effect('run queries preserve notification evidence at the reading boundary', () =>
    Effect.gen(function* () {
      const { world, runtime, call, projectId } = yield* Evidence;
      const threadId = yield* thread(projectId);
      const ids = yield* runsOn(threadId, 3);
      const db = Context.get(runtime.graph, MachineStore).db;
      const units = Context.get(runtime.graph, MachineUnits);
      const at = '2026-09-09T17:19:55.000Z';
      const notification = {
        id: 'attempt-0',
        startedAt: at,
        finishedAt: at,
        phase: 'subscriber' as const,
        subscriber: 'envelope reports',
        delivered: [],
        exhaustedAt: null,
        observationFailure: null,
        lastFailure: {
          attemptId: 'attempt-0',
          at,
          phase: 'subscriber' as const,
          subscriber: 'envelope reports',
          cause: [
            {
              kind: 'defect' as const,
              tag: null,
              port: null,
              message: 'Delivery trace rejected',
              detail: 'parent boundary',
              fiberId: null,
            },
          ],
        },
      };
      for (const id of ids.slice(0, 2)) {
        yield* units.write('evidence', (unit) =>
          unit.run(
            db
              .update(threadRun())
              .set({
                settledNotification: notification,
                settledNotifyAttempts: 0,
                settledNotifiedAt: null,
                settledBy: null,
              })
              .where(eq(threadRun().id, id)),
          ),
        );
      }
      const request = {
        threads: [threadId],
        select: 'runs',
        limit: 1,
        where: [{ field: 'settledNotification.lastFailure.cause.0.kind', op: 'eq', value: 'defect' }],
        fields: ['status', 'settledNotifyAttempts', 'settledNotifiedAt', 'settledNotification', 'settledBy'],
      };
      const first = yield* query(projectId, request);
      expect(first.status).toBe(200);
      expect(first.answer.rows).toHaveLength(1);
      expect(first.answer.rows[0]).toMatchObject({
        status: 'completed',
        settledNotifyAttempts: 0,
        settledNotifiedAt: null,
        settledNotification: notification,
        settledBy: null,
      });
      expect(first.answer.cursor).not.toBeNull();
      const remaining = ids.slice(0, 2).find((id) => id !== first.answer.rows[0]?.runId)!;
      const confirmedAt = '2026-09-09T17:21:06.000Z';
      yield* units.write('evidence', (unit) =>
        unit.run(
          db
            .update(threadRun())
            .set({
              settledNotifyAttempts: 1,
              settledNotifiedAt: new Date(confirmedAt),
              settledNotification: { ...notification, id: 'attempt-1', phase: 'confirmation', subscriber: null },
            })
            .where(eq(threadRun().id, remaining)),
        ),
      );

      const rest = yield* query(projectId, { ...request, cursor: first.answer.cursor });
      expect(rest.status).toBe(200);
      expect(rest.answer.rows).toEqual([
        {
          threadId,
          runId: remaining,
          status: 'completed',
          settledNotifyAttempts: 0,
          settledNotifiedAt: null,
          settledNotification: notification,
          settledBy: null,
        },
      ]);
      const current = yield* query(projectId, { ...request, where: [{ field: 'runId', op: 'eq', value: remaining }] });
      expect(current.answer.rows[0]).toMatchObject({
        settledNotifyAttempts: 1,
        settledNotifiedAt: confirmedAt,
        settledNotification: { phase: 'confirmation', lastFailure: notification.lastFailure },
      });
      const historical = yield* query(projectId, { ...request, where: [{ field: 'runId', op: 'eq', value: ids[2] }] });
      expect(historical.answer.rows[0]).toMatchObject({ settledNotification: null, settledNotifyAttempts: 0, settledNotifiedAt: null });
    }),
  );

  it.effect('a summed path nothing carries is counted as unknown, never as zero', () =>
    Effect.gen(function* () {
      const { world, runtime, call, projectId } = yield* Evidence;
      const threadId = yield* thread(projectId);
      yield* log(threadId, ['message', 'message']);

      const summed = yield* query(projectId, {
        select: 'records',
        threads: [threadId],
        group: ['kind'],
        count: true,
        sum: ['usage.totalTokens'],
      });
      expect(summed.answer.groups).toEqual([{ by: { kind: 'message' }, count: 2, unknown: { 'usage.totalTokens': 2 } }]);
    }),
  );

  it.effect('a field the source does not carry refuses by name rather than answering nothing', () =>
    Effect.gen(function* () {
      const { world, runtime, call, projectId } = yield* Evidence;
      const threadId = yield* thread(projectId);
      yield* log(threadId, ['message']);

      const refused = yield* query(projectId, {
        select: 'records',
        threads: [threadId],
        where: [{ field: 'invented', op: 'eq', value: 'x' }],
      });
      expect(refused.status).toBe(409);
      expect((refused.body as unknown as { code: string }).code).toBe('unknown-field');

      const missing = yield* query(projectId, {
        select: 'records',
        threads: [threadId],
        where: [{ field: 'entry.nothingHere', op: 'exists' }],
      });
      expect(missing.status).toBe(200);
      expect(missing.answer.rows).toEqual([]);
    }),
  );

  it.effect('addressed expansion carries every recorded payload facet, and a missing address is answered as that address', () =>
    Effect.gen(function* () {
      const { world, runtime, call, projectId } = yield* Evidence;
      const threadId = yield* thread(projectId);
      const context = {
        runId: 'run-1',
        stepNumber: 4,
        provider: 'subscription',
        model: 'claude-opus-5-5',
        contextWindow: 200_000,
        measuredAt: '2026-09-06T10:00:00.000Z',
      };
      yield* append(threadId, [
        { id: 'step-finished', kind: 'step-finished', payload: { context, usage: { inputTokens: 7, totalTokens: 7 } } },
        { id: 'withdrew', kind: 'withdrawal', payload: { withdrawn: { runId: 'run-1', keepMessages: 2 } } },
      ]);

      const expanded = yield* call(`/api/op/read_thread_record?project=${projectId}`, {
        method: 'POST',
        body: {
          at: [
            { threadId, at: 1 },
            { threadId, at: 2 },
            { threadId, at: 99 },
          ],
        },
      });
      expect(expanded.status).toBe(200);
      const rows = (expanded.body as { expanded: ReturnType<typeof asExpandedRecord>[] }).expanded;
      const step = rows[0];
      if (step === undefined || !('record' in step)) return yield* Effect.die('the step record was not expanded');
      expect(step.record.at).toBe(1);
      expect(step.record.context).toEqual(context);
      expect(step.record.usage?.totalTokens).toBe(7);
      const selected = yield* query(projectId, {
        select: 'records',
        threads: [threadId],
        where: [{ field: 'at', op: 'eq', value: step.record.at }],
        order: { by: 'at', dir: 'asc' },
        fields: ['at', 'id'],
      });
      expect(selected.status).toBe(200);
      expect(selected.answer.rows).toEqual([{ threadId, at: step.record.at, id: step.record.id }]);
      const withdrawal = rows[1];
      if (withdrawal === undefined || !('record' in withdrawal)) return yield* Effect.die('the withdrawal was not expanded');
      expect(withdrawal.record.withdrawn).toEqual({ runId: 'run-1', keepMessages: 2 });
      expect(rows[2]).toMatchObject({ threadId, at: 99 });
      expect('missing' in (rows[2] as ReturnType<typeof asExpandedRecord>)).toBe(true);
    }),
  );

  it.effect('a thread is selected by what its runs did, not by the model it is set to now', () =>
    Effect.gen(function* () {
      const { world, runtime, call, projectId } = yield* Evidence;
      const threadId = yield* thread(projectId);
      yield* call(`/api/threads/${threadId}/settings?project=${projectId}`, {
        method: 'PUT',
        body: { provider: 'subscription', model: 'claude-haiku-5-5', reasoning: null, switches: {} },
      });

      const byCurrent = yield* call(`/api/op/list_threads?project=${projectId}`, {
        method: 'POST',
        body: { ids: [threadId], models: ['claude-haiku-5-5'], shape: 'rows' },
      });
      expect((byCurrent.body as { rows: unknown[] }).rows).toEqual([]);

      const all = yield* call(`/api/op/list_threads?project=${projectId}`, {
        method: 'POST',
        body: { set: 'all', ids: [threadId], shape: 'rows' },
      });
      expect((all.body as { rows: { id: string }[] }).rows.map((row) => row.id)).toContain(threadId);
    }),
  );

  it.effect('a ranking covers the whole population and an aggregate is cut only in its answer', () =>
    Effect.gen(function* () {
      const { world, runtime, call, projectId } = yield* Evidence;
      const threadId = yield* thread(projectId);
      yield* append(
        threadId,
        [3, 1, 2].map((tokens, index) => ({
          id: `step-${index}`,
          kind: 'step-finished',
          payload: {
            context: {
              runId: 'run-1',
              stepNumber: index,
              provider: 'subscription',
              model: index === 2 ? 'claude-haiku-4-5' : 'claude-opus-5-5',
              contextWindow: 200_000,
              measuredAt: '2026-09-06T10:00:00.000Z',
            },
            usage: { inputTokens: tokens, totalTokens: tokens },
          },
        })),
      );

      const slowest = yield* query(projectId, {
        select: 'steps',
        threads: [threadId],
        order: { by: 'usage.totalTokens', dir: 'desc' },
        limit: 2,
      });
      expect(slowest.answer.rows.map((row) => row.at)).toEqual([1, 3]);
      expect(slowest.answer.coverage.complete).toBe(true);
      expect(slowest.answer.coverage.truncated).toBe(true);
      expect(slowest.answer.cursor).not.toBeNull();
      const rest = yield* query(projectId, {
        select: 'steps',
        threads: [threadId],
        order: { by: 'usage.totalTokens', dir: 'desc' },
        limit: 2,
        cursor: slowest.answer.cursor as string,
      });
      expect(rest.answer.rows.map((row) => row.at)).toEqual([2]);
      expect(rest.answer.coverage.complete).toBe(true);
      expect(rest.answer.coverage.truncated).toBe(false);
      expect(rest.answer.cursor).toBeNull();

      const perModel = yield* query(projectId, {
        select: 'steps',
        threads: [threadId],
        group: ['model'],
        count: true,
        sum: ['usage.totalTokens'],
        order: { by: 'count', dir: 'desc' },
        limit: 1,
      });
      expect(perModel.answer.groups).toEqual([{ by: { model: 'claude-opus-5-5' }, count: 2, sum: { 'usage.totalTokens': 4 } }]);
      expect(perModel.answer.coverage.complete).toBe(true);
      expect(perModel.answer.coverage.truncated).toBe(true);
      const nextGroup = yield* query(projectId, {
        select: 'steps',
        threads: [threadId],
        group: ['model'],
        count: true,
        sum: ['usage.totalTokens'],
        order: { by: 'count', dir: 'desc' },
        limit: 1,
        cursor: perModel.answer.cursor as string,
      });
      expect(nextGroup.answer.groups).toEqual([{ by: { model: 'claude-haiku-4-5' }, count: 1, sum: { 'usage.totalTokens': 2 } }]);
      expect(nextGroup.answer.cursor).toBeNull();
    }),
  );

  it.effect('a grouped result crosses a full page and retrieves each group exactly once', () =>
    Effect.gen(function* () {
      const { world, runtime, call, projectId } = yield* Evidence;
      const threadId = yield* thread(projectId);
      const facts = 401;
      yield* append(
        threadId,
        Array.from({ length: facts }, (_, index) => ({
          id: `large-step-${index}`,
          kind: 'step-finished',
          payload: {
            context: {
              runId: 'run-1',
              stepNumber: index,
              provider: 'subscription',
              model: `model-${String(index).padStart(4, '0')}`,
              contextWindow: 200_000,
              measuredAt: '2026-09-06T10:00:00.000Z',
            },
            usage: { inputTokens: 1, totalTokens: 1 },
          },
        })),
      );

      const ask = {
        select: 'steps' as const,
        threads: [threadId],
        group: ['model'],
        count: true,
        sum: ['usage.totalTokens'],
        order: { by: 'model', dir: 'asc' as const },
        limit: 400,
      };
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      let read = 0;
      do {
        const page: Effect.Success<ReturnType<typeof query>> = yield* query(projectId, {
          ...ask,
          cursor: cursor ?? undefined,
        });
        expect(page.status).toBe(200);
        expect(page.answer.coverage.complete).toBe(true);
        read = page.answer.coverage.read;
        for (const group of page.answer.groups ?? []) seen.push(String((group.by as { model: string }).model));
        cursor = page.answer.cursor;
        pages += 1;
        if (pages > 20) return yield* Effect.die('the reading did not end');
      } while (cursor !== null);

      expect(seen.length).toBe(facts);
      expect(new Set(seen).size).toBe(facts);
      expect(seen[0]).toBe('model-0000');
      expect(seen.at(-1)).toBe('model-0400');
      expect(pages).toBe(2);
      expect(read).toBe(facts);
    }),
  );

  it.effect('a ranked result pages: five ordered rows, two at a time, each exactly once', () =>
    Effect.gen(function* () {
      const { world, runtime, call, projectId } = yield* Evidence;
      const threadId = yield* thread(projectId);
      yield* append(
        threadId,
        [50, 10, 40, 20, 30].map((tokens, index) => ({
          id: `ranked-step-${index}`,
          kind: 'step-finished',
          payload: {
            context: {
              runId: 'run-1',
              stepNumber: index,
              provider: 'subscription',
              model: 'claude-opus-5-5',
              contextWindow: 200_000,
              measuredAt: '2026-09-06T10:00:00.000Z',
            },
            usage: { inputTokens: tokens, totalTokens: tokens },
          },
        })),
      );

      const ask = { select: 'steps' as const, threads: [threadId], order: { by: 'usage.totalTokens', dir: 'desc' as const }, limit: 2 };
      const seen: unknown[] = [];
      const populations: unknown[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const page: Effect.Success<ReturnType<typeof query>> = yield* query(projectId, {
          ...ask,
          cursor: cursor ?? undefined,
        });
        expect(page.answer.coverage.complete).toBe(true);
        populations.push(page.answer.threads);
        seen.push(...page.answer.rows.map((row) => row['usage.totalTokens'] ?? row.usage));
        cursor = page.answer.cursor;
        pages += 1;
      } while (cursor !== null && pages < 10);

      expect(seen).toEqual([
        { inputTokens: 50, totalTokens: 50 },
        { inputTokens: 40, totalTokens: 40 },
        { inputTokens: 30, totalTokens: 30 },
        { inputTokens: 20, totalTokens: 20 },
        { inputTokens: 10, totalTokens: 10 },
      ]);
      expect(pages).toBe(3);
      expect(new Set(populations.map((held) => JSON.stringify(held))).size).toBe(1);
    }),
  );

  it.effect('a research listing pages a fixed membership, not a boundary on a clock that moves', () =>
    Effect.gen(function* () {
      const { world, runtime, call, projectId } = yield* Evidence;
      const threads: string[] = [];
      for (let index = 0; index < 5; index += 1) threads.push(yield* thread(projectId));
      for (const [index, threadId] of threads.entries()) yield* readerClockOf(threadId, 1_000 + index);

      const evidence = evidenceQueriesOf(runtime.owners);
      const asked = { limit: '2', ids: threads.join(',') } as const;
      const page = (cursor?: string) =>
        evidence.list({ kind: 'thread', threadId: threads[0] as string }, projectId, {
          asked,
          selection: { view: 'live', ids: threads, limit: 2 },
          limit: 2,
          cursor,
        });

      const named = threads as [string, string, string, string, string];
      const first = yield* page();
      expect(first.rows.map((row) => row.id)).toEqual([named[4], named[3]]);
      expect(first.total).toBe(5);
      expect(first.cursor).not.toBeNull();

      yield* readerClockOf(threads[1] as string, 9_999);
      yield* call(`/api/op/archive_thread?project=${projectId}`, { method: 'POST', body: { threadId: threads[2], archived: true } });

      const second = yield* page(first.cursor as string);
      expect(second.rows.map((row) => row.id)).toEqual([named[2], named[1]]);
      expect(second.rows[0]?.archivedAt).not.toBeNull();
      const third = yield* page(second.cursor as string);
      expect(third.rows.map((row) => row.id)).toEqual([named[0]]);
      expect(third.cursor).toBeNull();

      expect([...first.rows, ...second.rows, ...third.rows].map((row) => row.id)).toEqual([
        named[4],
        named[3],
        named[2],
        named[1],
        named[0],
      ]);

      yield* readerClockOf(named[3], 9_998);
      const overHttp = yield* call(`/api/op/list_threads?project=${projectId}`, {
        method: 'POST',
        body: { ids: threads, limit: 2, shape: 'rows' },
      });
      const httpPage = overHttp.body as { rows: { id: string }[]; total: number; before: string | null };
      expect(httpPage.rows.map((row) => row.id)).toEqual([named[1], named[3]]);
      expect(httpPage.total).toBe(4);
      expect(httpPage.before).not.toBeNull();
      yield* readerClockOf(named[0], 9_997);
      const httpNext = yield* call(`/api/op/list_threads?project=${projectId}`, {
        method: 'POST',
        body: { ids: threads, limit: 2, cursor: httpPage.before, shape: 'rows' },
      });
      const nextPage = httpNext.body as { rows: { id: string }[]; before: string | null };
      expect({ status: httpNext.status, body: httpNext.body }).toMatchObject({ status: 200 });
      expect(nextPage.rows.map((row) => row.id)).toEqual([named[4], named[0]]);
      expect(nextPage.before).toBeNull();

      expect(
        yield* Effect.flip(
          evidence.list({ kind: 'thread', threadId: threads[0] as string }, projectId, {
            asked: { ...asked, title: 'something else' },
            selection: { view: 'live', ids: threads, title: 'something else', limit: 2 },
            limit: 2,
            cursor: first.cursor as string,
          }),
        ),
      ).toMatchObject({ code: 'cursor-stale' });
    }),
  );

  it.effect('a cursor nobody issued refuses rather than restarting the set or reading a file it names', () =>
    Effect.gen(function* () {
      const { world, runtime, call, projectId } = yield* Evidence;
      const threadId = yield* thread(projectId);
      yield* log(threadId, ['message', 'message']);

      for (const cursor of [
        'not-base64-at-all!!',
        Buffer.from('null', 'utf8').toString('base64url'),
        Buffer.from('{}', 'utf8').toString('base64url'),
        Buffer.from(JSON.stringify({ k: 'x', at: 0, key: null }), 'utf8').toString('base64url'),
        Buffer.from(JSON.stringify({ k: 'r', r: '../../etc/passwd', at: 0, key: null }), 'utf8').toString('base64url'),
        Buffer.from(JSON.stringify({ k: 'd', d: '{}', mac: 'forged', at: 0, key: null }), 'utf8').toString('base64url'),
        Buffer.from(JSON.stringify({ k: 'r', r: 'x', at: -1, key: null }), 'utf8').toString('base64url'),
      ]) {
        const refused = yield* query(projectId, { select: 'records', threads: [threadId], limit: 1, cursor });
        expect({ cursor, status: refused.status }).toEqual({ cursor, status: 409 });
        expect((refused.body as { code: string }).code).toBe('cursor-stale');
      }
    }),
  );

  it.effect('a cursor may not be walked outside the reading it names, even when its descriptor is genuine', () =>
    Effect.gen(function* () {
      const { world, runtime, call, projectId } = yield* Evidence;
      const threadId = yield* thread(projectId);
      yield* log(threadId, ['message', 'message', 'message', 'message']);

      const first = yield* query(projectId, { select: 'records', threads: [threadId], limit: 1 });
      expect(first.answer.cursor).not.toBeNull();
      const carried = JSON.parse(Buffer.from(first.answer.cursor as string, 'base64url').toString('utf8')) as {
        stop: { kind: string; at: number; sourceKey: string | null };
      };
      const walked = (stop: Record<string, unknown>) => Buffer.from(JSON.stringify({ ...carried, stop }), 'utf8').toString('base64url');

      for (const [why, stop] of [
        ['past the pinned head', { kind: 'source', at: 0, sourceKey: '99999' }],
        ['not a position', { kind: 'source', at: 0, sourceKey: 'wherever' }],
        ['past the membership', { kind: 'source', at: 7, sourceKey: null }],
        ['a result this question has none of', { kind: 'result', at: 3 }],
      ] as const) {
        const refused = yield* query(projectId, {
          select: 'records',
          threads: [threadId],
          limit: 1,
          cursor: walked(stop),
        });
        expect({ why, status: refused.status }).toEqual({ why, status: 409 });
        expect((refused.body as { code: string }).code).toBe('cursor-stale');
      }

      const second = yield* query(projectId, { select: 'records', threads: [threadId], limit: 1, cursor: first.answer.cursor as string });
      expect(second.status).toBe(200);
      expect(second.answer.rows.length).toBe(1);
    }),
  );

  it.effect('a thread read from under another project is refused naming the project, on the shape, the query and expansion alike', () =>
    Effect.gen(function* () {
      const { world, runtime, call, projectId } = yield* Evidence;
      const foreign = yield* world.plainProject();
      const threadId = yield* thread(projectId);
      yield* log(threadId, ['message']);
      const refusal = {
        code: 'place-mismatch',
        unblock: [`call project ${projectId} for this subject`, `or name a subject in project ${foreign}`],
      };

      const shape = yield* call(`/api/op/read_thread?project=${foreign}`, { method: 'POST', body: { threadId } });
      expect(shape.status).toBe(409);
      expect(shape.body).toMatchObject(refusal);

      const queried = yield* query(foreign, { select: 'records', threads: [threadId], limit: 10 });
      expect(queried.status).toBe(409);
      expect(queried.body).toMatchObject(refusal);

      const expanded = yield* call(`/api/op/read_thread_record?project=${foreign}`, {
        method: 'POST',
        body: { at: [{ threadId, at: 1 }] },
      });
      expect(expanded.status).toBe(409);
      expect(expanded.body).toMatchObject(refusal);
    }),
  );

  it.effect('a stored tool output survives expansion whole while a query page stays body-free', () =>
    Effect.gen(function* () {
      const { world, runtime, call, projectId } = yield* Evidence;
      const threadId = yield* thread(projectId);
      const home = yield* world.directory('tool-outputs');
      const outputs = threadToolOutputStore(home);
      const scope = outputs.scope({ threadId, ownerId: 'owner', runId: null });
      const whole = `retained-result-${threadId}\n${'evidence\n'.repeat(TOOL_OUTPUT_MAX_BYTES)}`;
      const projected = yield* scope.project({
        toolCallId: 'retained-call',
        toolName: 'read_performance',
        output: whole,
        modelOutput: { type: 'text', value: whole },
        keep: 'head',
      });
      const retained = projected.output as { outputId: string; preview: string };
      const file = join(home, threadId, `${retained.outputId}.txt`);
      const modelText = `model-only-result-${threadId}`;
      const messages = [
        Message.tool({ id: 'retained-call', name: 'read_performance', result: projected.modelOutput }),
        Message.tool({ id: 'inline-call', name: 'foreign_tool', result: { type: 'text', value: modelText } }),
      ];
      try {
        yield* append(threadId, [
          {
            id: 'output-0',
            kind: 'tool',
            payload: {
              entry: {
                type: 'tool',
                id: 'tool:output-0',
                toolName: 'read_performance',
                toolCallId: 'output-0',
                toolState: 'output-available',
                toolOutput: projected.output,
              },
            },
          },
          { id: 'model-facet', kind: 'step', payload: { messages } },
        ]);

        const expanded = yield* call(`/api/op/read_thread_record?project=${projectId}`, {
          method: 'POST',
          body: {
            at: [
              { threadId, at: 1 },
              { threadId, at: 2 },
            ],
          },
        });
        const rows = (expanded.body as { expanded: ReturnType<typeof asExpandedRecord>[] }).expanded;
        const tool = rows[0];
        if (tool === undefined || !('record' in tool)) return yield* Effect.die('the tool record was not expanded');
        expect(tool.record.entry?.toolOutput).toEqual(projected.output);
        const step = rows[1];
        if (step === undefined || !('record' in step)) return yield* Effect.die('the step record was not expanded');
        expect(step.record.messages?.map((message) => message.content)).toEqual(messages.map((message) => message.content));
        expect(yield* (yield* FileSystem.FileSystem).readFileString(file)).toBe(whole);

        const narrowed = yield* call(`/api/op/read_thread_record?project=${projectId}`, {
          method: 'POST',
          body: { at: [{ threadId, at: 1 }], fields: ['entry.toolName'] },
        });
        const selected = (narrowed.body as { expanded: ExpandedRecord[] }).expanded[0];
        if (selected === undefined || !('record' in selected)) return yield* Effect.die('the narrowed record was not expanded');
        expect((selected.record as unknown as Record<string, unknown>)['entry.toolName']).toBe('read_performance');
        expect(selected.record.kind).toBe('tool');
        expect(selected.record.at).toBe(1);
        expect(JSON.stringify(selected)).not.toContain('toolOutput');

        const page = yield* query(projectId, { select: 'records', threads: [threadId], limit: 10 });
        const rendered = threadToolText({ status: 'ok', evidence: page.answer }) ?? '';
        expect(rendered).not.toContain(retained.outputId);
        expect(rendered).not.toContain(modelText);
      } finally {
        yield* outputs.releaseThread(threadId);
      }
    }),
  );

  it.effect('a retained tool value is projected on expansion, and a lost one says why', () =>
    Effect.gen(function* () {
      const { world, runtime, call, projectId } = yield* Evidence;
      const threadId = yield* thread(projectId);
      const outputs = threadToolOutputStore(join(world.dataHome, 'tool-outputs'));
      const scope = outputs.scope({ threadId, ownerId: 'owner', runId: null });
      const answer = {
        status: 'ok',
        rows: [{ at: 0, id: `tool:${threadId}-0`, kind: 'tool' }],
        detail: 'x'.repeat(WIRE_ENTRY_MAX_BYTES),
      };
      const projected = yield* scope.project({
        toolCallId: 'wide-call',
        toolName: 'read_thread',
        output: answer,
        modelOutput: { type: 'text', value: `one row of ${threadId}` },
        keep: 'head',
      });
      const pointer = projected.output as { outputId: string };
      const expandOne = () =>
        call(`/api/op/read_thread_record?project=${projectId}`, {
          method: 'POST',
          body: {
            at: [{ threadId, at: 1 }],
            fields: ['entry.toolOutput.rows', 'entry.toolOutput.status', 'entry.toolOutput.outputId', 'entry.toolOutput.unavailable'],
          },
        });
      const toolOutputOf = (answered: { body: unknown }): unknown => {
        const row = (answered.body as { expanded: ExpandedRecord[] }).expanded[0];
        if (row === undefined || !('record' in row)) throw new Error('the tool record was not expanded');
        return row.record;
      };
      try {
        yield* append(threadId, [
          {
            id: 'wide-0',
            kind: 'tool',
            payload: {
              entry: {
                type: 'tool',
                id: 'tool:wide-0',
                toolName: 'read_thread',
                toolCallId: 'wide-0',
                toolState: 'output-available',
                toolOutput: projected.output,
              },
            },
          },
        ]);

        expect(toolOutputOf(yield* expandOne())).toMatchObject({ 'entry.toolOutput.status': 'ok', 'entry.toolOutput.rows': answer.rows });

        yield* outputs.releaseThread(threadId);
        const lost = toolOutputOf(yield* expandOne()) as Record<string, unknown>;
        expect(lost['entry.toolOutput.outputId']).toBe(pointer.outputId);
        expect(typeof lost['entry.toolOutput.unavailable']).toBe('string');
      } finally {
        yield* outputs.releaseThread(threadId);
      }
    }),
  );

  it.effect('a tool output larger than one answer reads whole in pages from outputFrom, inline or retained', () =>
    Effect.gen(function* () {
      const { world, runtime, call, projectId } = yield* Evidence;
      const threadId = yield* thread(projectId);
      const answer = { status: 'ok', detail: '語'.repeat(Math.ceil(TOOL_OUTPUT_MAX_BYTES / 3)) };
      const stdout = 'stdout line 語\n'.repeat(Math.ceil((TOOL_OUTPUT_MAX_BYTES * 2) / 16));
      const outputs = threadToolOutputStore(join(world.dataHome, 'tool-outputs'));
      const projected = yield* outputs.scope({ threadId, ownerId: 'owner', runId: null }).project({
        toolCallId: 'retained-0',
        toolName: 'bash',
        output: stdout,
        modelOutput: { type: 'text', value: stdout },
        keep: 'head',
      });
      const retained = projected.output as { readonly outputId: string };
      const tool = (id: string, toolOutput: unknown) => ({
        id,
        kind: 'tool' as const,
        payload: {
          entry: {
            type: 'tool' as const,
            id: `tool:${id}`,
            toolName: 'bash',
            toolCallId: id,
            toolState: 'output-available' as const,
            toolOutput,
          },
        },
      });
      const expandFrom = Effect.fnUntraced(function* (at: number, outputFrom: number | undefined) {
        const answered = yield* call(`/api/op/read_thread_record?project=${projectId}`, {
          method: 'POST',
          body: { at: [{ threadId, at }], outputFrom },
        });
        return (answered.body as { expanded: ExpandedRecord[] }).expanded[0];
      });
      const pagedText = Effect.fnUntraced(function* (at: number) {
        const text: string[] = [];
        let from: number | null = 0;
        for (let pages = 0; from !== null; pages += 1) {
          if (pages > 10) return yield* Effect.die('the pages did not end');
          const held: ExpandedRecord | undefined = yield* expandFrom(at, from);
          if (held === undefined || !('output' in held)) return yield* Effect.die('the output was not paged');
          expect(held.output.from).toBe(from);
          text.push(held.output.text);
          from = held.output.next;
        }
        expect(text.length).toBeGreaterThan(1);
        return text.join('');
      });
      try {
        yield* append(threadId, [
          tool('inline-0', answer),
          tool('retained-0', {
            truncated: true,
            outputId: retained.outputId,
            byteLength: Buffer.byteLength(stdout),
            lineCount: stdout.split('\n').length,
            preview: stdout.slice(0, 200),
          }),
        ]);

        expect(yield* expandFrom(1, undefined)).toHaveProperty('unread');
        expect(JSON.parse(yield* pagedText(1))).toEqual(answer);
        expect(yield* pagedText(2)).toBe(stdout);
      } finally {
        yield* (yield* FileSystem.FileSystem).remove(join(world.dataHome, 'tool-outputs', threadId), { recursive: true, force: true });
      }
    }),
  );

  const TOOL = activityKind<{ readonly toolName: string; readonly toolCallId: string }>('tool-call');

  const recorded = Effect.fnUntraced(function* (threadId: string, runId: string, calls: readonly string[]) {
    const store = (yield* Evidence).activity;
    yield* Effect.forEach(
      calls,
      (toolCallId) =>
        activity(TOOL, { toolName: 'read', toolCallId }, note({ type: 'tool-executing' }), {
          thread: threadId,
          run: runId,
          bodies: [
            {
              kind: 'input',
              contentType: 'application/json',
              encoded: new TextEncoder().encode(JSON.stringify({ path: `${toolCallId}.md` })),
            },
          ],
        }),
      { discard: true },
    ).pipe(Effect.provideService(ActivityLog, store.log));
    yield* store.settled;
  });

  const callIds = (count: number, from = 0) => Array.from({ length: count }, (_, index) => `call-${from + index}`);

  it.effect('small pages walk every activity of a thread exactly once, across its runs', () =>
    Effect.gen(function* () {
      const { world, runtime, call, projectId } = yield* Evidence;
      const threadId = yield* thread(projectId);
      const [first, second] = (yield* runsOn(threadId, 2)) as [string, string];
      yield* recorded(threadId, first, callIds(4));
      yield* recorded(threadId, second, callIds(3, 4));

      const seen: string[] = [];
      let cursor: string | undefined;
      for (let pages = 0; ; pages += 1) {
        if (pages > 10) return yield* Effect.die('the reading did not end');
        const page = yield* query(projectId, {
          select: 'activity',
          threads: [threadId],
          where: [{ field: 'kind', op: 'eq', value: 'tool-call' }],
          fields: ['attrs.toolCallId', 'runId'],
          limit: 2,
          cursor,
        });
        expect(page.status).toBe(200);
        seen.push(...page.answer.rows.map((row) => String(row['attrs.toolCallId'])));
        if (page.answer.cursor === null) break;
        cursor = page.answer.cursor;
      }
      expect(seen.toSorted()).toEqual(callIds(7));
    }),
  );

  it.effect('every expanded address shares one envelope: a body past it stands unread with its size, never cut', () =>
    Effect.gen(function* () {
      const { world, runtime, call, projectId } = yield* Evidence;
      const threadId = yield* thread(projectId);
      const [runId] = (yield* runsOn(threadId, 1)) as [string];
      const store = (yield* Evidence).activity;
      const big = { text: 'x'.repeat(30 * 1024) };
      const encoded = new TextEncoder().encode(JSON.stringify(big));
      yield* Effect.forEach(
        ['wide-0', 'wide-1'],
        (toolCallId) =>
          activity(TOOL, { toolName: 'read', toolCallId }, Effect.void, {
            thread: threadId,
            run: runId,
            bodies: [{ kind: 'result', contentType: 'application/json', encoded }],
          }),
        { discard: true },
      ).pipe(Effect.provideService(ActivityLog, store.log));
      yield* store.settled;
      const listed = yield* query(projectId, {
        select: 'activity',
        threads: [threadId],
        order: { by: 'attrs.toolCallId', dir: 'asc' },
        limit: 5,
      });
      const expanded = yield* call(`/api/op/read_thread_record?project=${projectId}`, {
        method: 'POST',
        body: { at: listed.answer.rows.map((row) => ({ threadId, at: row.at })) },
      });
      expect(expanded.status).toBe(200);
      const records = (expanded.body as { expanded: ReturnType<typeof asExpandedRecord>[] }).expanded;
      const bodies = records.map((held) => ('fact' in held ? (held.fact.bodies as readonly Record<string, unknown>[])[0] : undefined));
      expect(bodies[0]).toMatchObject({ value: big, size: encoded.byteLength });
      expect(bodies[1]).toMatchObject({ unread: true, size: encoded.byteLength });
      expect(bodies[1]).not.toHaveProperty('value');
      expect(Buffer.byteLength(JSON.stringify(records))).toBeLessThanOrEqual(TOOL_OUTPUT_MAX_BYTES);
    }),
  );

  it.effect('an activity body reads whole in bounded UTF-8 pages, through a stored delta and oversized metadata', () =>
    Effect.gen(function* () {
      const { call, projectId, activity: store } = yield* Evidence;
      const threadId = yield* thread(projectId);
      const detail = '語\\\"\n'.repeat(Math.ceil(TOOL_OUTPUT_MAX_BYTES / 3));
      const documents = [
        { detail, messages: ['first'] },
        { detail, messages: ['first', 'second'] },
      ];
      const addresses: string[] = [];
      yield* Effect.forEach(
        documents,
        (document, index) =>
          activity(
            TOOL,
            { toolName: 'read', toolCallId: `paged-${index}` },
            index === 0
              ? Effect.void
              : Effect.forEach([0, 1, 2, 3], () => note({ type: 'detail', detail: 'm'.repeat(TOOL_OUTPUT_MAX_BYTES / 4) }), {
                  discard: true,
                }),
            {
              thread: threadId,
              bodies: [
                { kind: 'input', contentType: 'text/plain', encoded: new TextEncoder().encode('語plain') },
                {
                  kind: 'request',
                  contentType: 'application/json',
                  encoded: new TextEncoder().encode(JSON.stringify(document)),
                  series: true,
                },
              ],
            },
          ),
        { discard: true },
      ).pipe(Effect.provideService(ActivityLog, store.log));
      yield* store.settled;
      const listed = yield* query(projectId, {
        select: 'activity',
        threads: [threadId],
        fields: ['attrs.toolCallId'],
        order: { by: 'attrs.toolCallId', dir: 'asc' },
        limit: 2,
      });
      addresses.push(...listed.answer.rows.map((row) => String(row.at)));
      for (const [index, at] of addresses.entries()) {
        const pieces: string[] = [];
        let from: number | null = 0;
        for (let pages = 0; from !== null; pages += 1) {
          if (pages > 10) return yield* Effect.die('the body pages did not end');
          const read: { readonly status: number; readonly body: unknown } = yield* call(`/api/op/read_thread_record?project=${projectId}`, {
            method: 'POST',
            body: { threadId, at: [{ at }], outputFrom: from, body: 2 },
          });
          expect(read.status).toBe(200);
          expect(Buffer.byteLength(JSON.stringify(read.body))).toBeLessThanOrEqual(TOOL_OUTPUT_MAX_BYTES);
          const held: ExpandedRecord | undefined = (read.body as { expanded: ExpandedRecord[] }).expanded[0];
          if (held === undefined || !('output' in held)) return yield* Effect.die('the activity body was not paged');
          expect(held.output.from).toBe(from);
          expect(held.output.bytes).toBe(Buffer.byteLength(JSON.stringify(documents[index])));
          pieces.push(held.output.text);
          from = held.output.next;
        }
        expect(pieces.length).toBeGreaterThan(1);
        expect(pieces.join('')).toBe(JSON.stringify(documents[index]));
      }
      const resumed = yield* call(`/api/op/read_thread_record?project=${projectId}`, {
        method: 'POST',
        body: { threadId, at: [{ at: addresses[0] }], outputFrom: 1 },
      });
      expect((resumed.body as { expanded: ExpandedRecord[] }).expanded[0]).toMatchObject({
        output: { from: 3, text: 'plain', bytes: 8, next: null },
      });
      const missing = yield* call(`/api/op/read_thread_record?project=${projectId}`, {
        method: 'POST',
        body: { threadId, at: [{ at: addresses[0] }], outputFrom: 0, body: 3 },
      });
      expect((missing.body as { expanded: ExpandedRecord[] }).expanded[0]).toHaveProperty('missing');
      const other = yield* thread(projectId);
      const foreign = yield* call(`/api/op/read_thread_record?project=${projectId}`, {
        method: 'POST',
        body: { threadId: other, at: [{ at: addresses[0] }], outputFrom: 0 },
      });
      expect((foreign.body as { expanded: ExpandedRecord[] }).expanded[0]).toHaveProperty('missing');
    }),
  );

  it.effect('combined metadata fits the final expansion envelope or stands as a bounded unread address', () =>
    Effect.gen(function* () {
      const { world, runtime, call, projectId } = yield* Evidence;
      const threadId = yield* thread(projectId);
      const store = (yield* Evidence).activity;
      const large = 'x'.repeat(15 * 1024);
      const kind = activityKind<{ readonly toolCallId: string; readonly detail: string }, { readonly detail: string }>('metadata');
      yield* Effect.forEach(
        ['metadata-0', 'metadata-1'],
        (toolCallId) =>
          activity(kind, { toolCallId, detail: large }, Effect.void, {
            thread: threadId,
            ended: () => ({ result: { detail: large } }),
          }),
        { discard: true },
      ).pipe(Effect.provideService(ActivityLog, store.log));
      yield* store.settled;
      const listed = yield* query(projectId, {
        select: 'activity',
        threads: [threadId],
        order: { by: 'attrs.toolCallId', dir: 'asc' },
        limit: 2,
      });
      const expanded = yield* call(`/api/op/read_thread_record?project=${projectId}`, {
        method: 'POST',
        body: { at: listed.answer.rows.map((row) => ({ threadId, at: row.at })) },
      });
      expect(expanded.status).toBe(200);
      const records = (expanded.body as { expanded: ExpandedRecord[] }).expanded;
      expect(records[0]).toMatchObject({ fact: { attrs: { detail: large }, result: { detail: large } } });
      expect(records[1]).toMatchObject({ threadId, at: listed.answer.rows[1]?.at, unread: expect.any(String) });
      expect(Buffer.byteLength(JSON.stringify(expanded.body))).toBeLessThanOrEqual(TOOL_OUTPUT_MAX_BYTES);
      const markerBytes = Buffer.byteLength(JSON.stringify(records[1]));
      const overflow = yield* call(`/api/op/read_thread_record?project=${projectId}`, {
        method: 'POST',
        body: {
          at: Array.from({ length: Math.floor(TOOL_OUTPUT_MAX_BYTES / markerBytes) + 1 }, () => ({
            threadId,
            at: listed.answer.rows[1]?.at,
          })),
        },
      });
      expect(overflow.status).toBe(409);
      expect(overflow.body).toMatchObject({ code: 'selection-shape' });
    }),
  );

  it.effect('an activity is expanded at the address its row carried, with its notes and its body', () =>
    Effect.gen(function* () {
      const { world, runtime, call, projectId } = yield* Evidence;
      const threadId = yield* thread(projectId);
      const [runId] = (yield* runsOn(threadId, 1)) as [string];
      yield* recorded(threadId, runId, ['call-0']);
      const listed = yield* query(projectId, { select: 'activity', threads: [threadId], limit: 5 });
      const row = listed.answer.rows[0];
      expect(row).toMatchObject({ threadId, kind: 'tool-call', runId, outcome: 'ok' });

      const expanded = yield* call(`/api/op/read_thread_record?project=${projectId}`, {
        method: 'POST',
        body: {
          at: [
            { threadId, at: row?.at },
            { threadId, at: 'activity:01a00000-0000-7000-8000-000000000000' },
          ],
        },
      });
      expect(expanded.status).toBe(200);
      const [held, missing] = (expanded.body as { expanded: ReturnType<typeof asExpandedRecord>[] }).expanded;
      if (held === undefined || !('fact' in held)) return yield* Effect.die('the activity was not expanded');
      expect(held.fact).toMatchObject({
        kind: 'tool-call',
        attrs: { toolName: 'read', toolCallId: 'call-0' },
        notes: [{ type: 'tool-executing' }],
        bodies: [{ n: 1, kind: 'input', state: 'written', value: { path: 'call-0.md' } }],
      });
      expect(missing !== undefined && 'missing' in missing).toBe(true);
    }),
  );

  it.effect('a reading holds the instant it opened: an activity opened between its pages is not read', () =>
    Effect.gen(function* () {
      const { world, runtime, call, projectId } = yield* Evidence;
      const threadId = yield* thread(projectId);
      const [runId] = (yield* runsOn(threadId, 1)) as [string];
      yield* recorded(threadId, runId, callIds(2));
      const ask = { select: 'activity', threads: [threadId], fields: ['attrs.toolCallId'], limit: 1 } as const;
      const first = yield* query(projectId, ask);
      yield* Effect.sleep('5 millis');
      yield* recorded(threadId, runId, ['call-late']);
      const seen = first.answer.rows.map((row) => String(row['attrs.toolCallId']));
      for (let cursor = first.answer.cursor; cursor !== null;) {
        const page = yield* query(projectId, { ...ask, cursor });
        seen.push(...page.answer.rows.map((row) => String(row['attrs.toolCallId'])));
        cursor = page.answer.cursor;
      }
      expect(seen.toSorted()).toEqual(callIds(2));
    }),
  );

  it.effect('a selection by activity window names the threads that did something in it, and only those', () =>
    Effect.gen(function* () {
      const { world, runtime, call, projectId } = yield* Evidence;
      const active = yield* thread(projectId);
      const quiet = yield* thread(projectId);
      const [runId] = (yield* runsOn(active, 1)) as [string];
      const since = new Date((yield* Clock.currentTimeMillis) - 60_000).toISOString();
      yield* recorded(active, runId, ['call-0']);
      const listed = yield* call(`/api/op/list_threads?project=${projectId}`, {
        method: 'POST',
        body: { activeSince: since, ids: [active, quiet] },
      });
      expect(listed.status).toBe(200);
      expect((listed.body as { threads: { id: string }[] }).threads.map((row) => row.id)).toEqual([active]);
    }),
  );

  it.effect('entries of a branch read at the cost of its source: an inherited log is no slower to read than an own one', () =>
    Effect.gen(function* () {
      const { call, projectId } = yield* Evidence;
      const tool = (callId: string, toolName: string, toolState: string, occurredAt: string) => ({
        id: crypto.randomUUID(),
        kind: 'tool',
        payload: {
          entry: {
            type: 'tool',
            id: `tool:${callId}`,
            runId: 'run-1',
            toolCallId: callId,
            toolName,
            toolState,
            occurredAt,
            toolInput: { at: callId },
          },
        },
      });
      const source = yield* thread(projectId);
      yield* append(source, [
        ...Array.from({ length: 1500 }, (_, index) => tool(`read-${index}`, 'read', 'output-available', '2026-11-05T09:00:00.000Z')),
        tool('opened', 'open_page', 'input-available', '2026-11-05T11:00:00.000Z'),
      ]);
      const branchOf = (threadId: string) =>
        Effect.map(call(`/api/op/branch_thread?project=${projectId}`, { method: 'POST', body: { threadId } }), (branched) => {
          expect(branched.status).toBe(200);
          return String((branched.body as { threadId: string }).threadId);
        });
      const settled = yield* branchOf(source);
      yield* append(settled, [tool('opened', 'open_page', 'output-available', '2026-11-05T11:00:00.000Z')]);
      const branch = yield* branchOf(settled);
      yield* append(branch, [tool('acted', 'act_on_page', 'input-available', '2026-11-05T12:00:00.000Z')]);
      const browsing = Effect.fnUntraced(function* (threadId: string) {
        const started = performance.now();
        const answered = yield* query(projectId, {
          select: 'entries',
          threads: [threadId],
          where: [
            { field: 'toolName', op: 'in', value: ['open_page', 'navigate_page', 'act_on_page'] },
            { field: 'occurredAt', op: 'gte', value: '2026-11-05T10:00:00Z' },
          ],
          fields: ['threadId', 'occurredAt', 'toolName', 'entry.toolInput'],
          limit: 80,
        });
        return { ms: performance.now() - started, rows: answered.answer.rows.map((row) => [row.toolName, row['entry.toolInput']]) };
      });

      const own = yield* browsing(source);
      const inherited = yield* browsing(branch);
      expect(own.rows).toEqual([['open_page', { at: 'opened' }]]);
      expect(inherited.rows).toEqual([
        ['open_page', { at: 'opened' }],
        ['act_on_page', { at: 'acted' }],
      ]);
      expect(inherited.ms).toBeLessThan(own.ms * 4 + 250);
    }),
  );
});
