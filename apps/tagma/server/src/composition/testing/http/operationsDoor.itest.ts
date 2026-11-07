import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Effect, Layer } from 'effect';
import { THREAD_TOOL_CONFIRM_VALUE } from '@runlith/agent/transcript/parts';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import { eq, sql } from 'drizzle-orm';
import { thread } from '../../../threads/testing/doubles.js';
import { Usage } from '@runlith/llm/schema/events';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { OPERATOR_PRINCIPAL } from '../../../platform/contract/wire/actor.js';
import { makeDoorWorld } from '../doorFixture.js';
import type { HttpAnswer } from '../httpRequest.js';
import {
  ANSWER_HEADER,
  ANSWER_TEXT,
  APPROVAL_WAIT_HEADER,
  CALL_HEADER,
  CONTRACT_HEADER,
  OUTCOME_HEADER,
} from '../../../invocation/contract/wire/headers.js';
import type { OperationsAnswer } from '../../../invocation/contract/wire/operations.js';
import { GRANT_HEADER, GRANT_VARIABLE } from '../../../platform/contract/service/credentials.js';
import { grantEnvironment } from '../../../platform/testing/grants.js';
import { testSessionIdentity } from '../../../platform/testing/identity.js';
import { MCP_SESSION_HEADER } from '../../../platform/contract/wire/session.js';

const setup = Effect.gen(function* () {
  const world = yield* makeDoorWorld();
  return { world, projectId: yield* world.stealthProject(), threads: new Map<'trust' | 'bypass' | 'review', HttpAnswer>() };
});
class Place extends Context.Service<Place, Effect.Success<typeof setup>>()('testing/OperationPlace') {}
const threadIn = Effect.fnUntraced(function* (approvalMode: 'trust' | 'bypass' | 'review') {
  const { world, projectId, threads } = yield* Place;
  const held = threads.get(approvalMode);
  if (held !== undefined) return held;
  const born = yield* world.op('create_thread', { approvalMode }, `project=${projectId}`);
  expect(born.status).toBe(200);
  threads.set(approvalMode, born);
  return born;
});
const perform = (id: string, body: unknown, project?: number) =>
  Effect.flatMap(Place, ({ world }) => world.op(id, body, project === undefined ? '' : `project=${project}`));
const codeOf = (body: unknown): string => (body as { readonly code: string }).code;
const request = Effect.fnUntraced(function* (id: string, input: unknown, project?: number, headers?: Record<string, string>) {
  const { world } = yield* Place;
  return yield* Effect.promise((signal) =>
    world.app(
      new Request(`http://tagma/api/op/${id}${project === undefined ? '' : `?project=${project}`}`, {
        signal,
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(input),
      }),
      world.routed,
    ),
  );
});
const answered = Effect.fnUntraced(function* (id: string, input: unknown, project?: number, headers?: Record<string, string>) {
  const response = yield* request(id, input, project, headers);
  const body: unknown = yield* Effect.promise(() => response.json());
  return { status: response.status, body };
});

layer(Layer.effect(Place, setup), { excludeTestServices: true })('operation HTTP door', (it) => {
  it.effect('a session standing in no project performs a machine operation and is refused only where a project is needed', () =>
    Effect.gen(function* () {
      const headers = { [MCP_SESSION_HEADER]: 'claude-code:projectless' };
      expect(yield* answered('list_projects', {}, undefined, headers)).toMatchObject({ status: 200, body: { status: 'ok' } });
      expect(yield* answered('read_tags', {}, undefined, headers)).toMatchObject({ status: 409, body: { code: 'project-required' } });
    }),
  );
  it.effect('caller rights are enforced at HTTP admission, and an operator act refuses a thread in every mode', () =>
    Effect.gen(function* () {
      const { projectId } = yield* Place;
      const target = yield* threadIn('trust');
      const threadId = (target.body as { snapshot: { thread: { id: string } } }).snapshot.thread.id;
      const grant = grantEnvironment(threadId, testSessionIdentity)[GRANT_VARIABLE] as string;
      expect(yield* answered('read_thread_snapshot', { threadId }, projectId, { [GRANT_HEADER]: grant })).toMatchObject({
        status: 409,
        body: { code: 'operator-only' },
      });
      expect(yield* answered('read_thread_snapshot', { threadId }, projectId)).toMatchObject({ status: 200, body: { status: 'loaded' } });
      expect(yield* answered('read_hosted_agent', {}, projectId)).toMatchObject({ status: 409, body: { code: 'thread-required' } });
      expect(yield* answered('read_hosted_agent', {}, projectId, { [GRANT_HEADER]: grant })).toMatchObject({
        status: 409,
        body: { code: 'not-hosted' },
      });
      const bypass = yield* threadIn('bypass');
      const bypassId = (bypass.body as { snapshot: { thread: { id: string } } }).snapshot.thread.id;
      const bypassGrant = grantEnvironment(bypassId, testSessionIdentity)[GRANT_VARIABLE] as string;
      expect(yield* answered('read_thread_snapshot', { threadId: bypassId }, projectId, { [GRANT_HEADER]: bypassGrant })).toMatchObject({
        status: 409,
        body: { code: 'operator-only' },
      });
    }),
  );
  it.effect('a thread reads an adapter’s settings through its own door', () =>
    Effect.gen(function* () {
      const born = yield* threadIn('trust');
      const threadId = (born.body as { snapshot: { thread: { id: string } } }).snapshot.thread.id;
      const trusted = { [GRANT_HEADER]: grantEnvironment(threadId, testSessionIdentity)[GRANT_VARIABLE] as string };
      expect(yield* answered('read_adapter_settings', { adapter: 'openai-compatible' }, undefined, trusted)).toMatchObject({
        status: 200,
        body: { status: 'read', settings: { adapter: 'openai-compatible', discovers: true } },
      });
    }),
  );
  it.effect('operation fields refuse at request decoding', () =>
    Effect.gen(function* () {
      const unknown = yield* perform('read_operations', { ids: ['read_block'], misspelled: true });
      expect(unknown.status).toBe(409);
      expect(unknown.body).toMatchObject({ code: 'body-shape', reason: expect.stringContaining('misspelled'), unblock: expect.any(Array) });
    }),
  );
  it.effect('an unknown operation and a socket-only operation refuse before dispatch', () =>
    Effect.gen(function* () {
      const { projectId } = yield* Place;
      const unknown = yield* perform('no_such_operation', {});
      expect(unknown.status).toBe(409);
      expect(codeOf(unknown.body)).toBe('unknown-operation');
      const continued = yield* perform('compact_thread', {});
      expect(continued.status).toBe(409);
      expect(continued.body).toMatchObject({ code: 'thread-channel' });
      const stopped = yield* perform(
        'stop_command',
        { operationId: 'missing-operation', execution: 'missing-command', incarnation: 1, cause: 'explicit-stop' },
        projectId,
      );
      expect(stopped.status).toBe(409);
      expect(codeOf(stopped.body)).toBe('terminal-no-command');
    }),
  );
  it.effect('the op road names each call’s outcome, and every answer the contract it was served under', () =>
    Effect.gen(function* () {
      const read = yield* request('read_operations', { ids: ['read_block'] });
      expect(read.status).toBe(200);
      expect(read.headers.get(OUTCOME_HEADER)).toBe('answer');
      const answer = (yield* Effect.promise(() => read.json())) as OperationsAnswer;
      expect(read.headers.get(CONTRACT_HEADER)).toBe(answer.contract);
      expect(answer.operations.rows.map((row) => row.id)).toEqual(['read_block']);
      const refused = yield* request('read_block', { blockIds: [] });
      expect(refused.status).toBe(409);
      expect(refused.headers.get(OUTCOME_HEADER)).toBe('refusal');
    }),
  );
  it.effect('the op road answers the document, its journal range on a graph act, and the text beside it only when asked', () =>
    Effect.gen(function* () {
      const { projectId } = yield* Place;
      const parentId = ((yield* answered('list_root_blocks', {}, projectId)).body as { blocks: { name: string }[] }).blocks[0]!.name;
      const plain = yield* answered('create_block', { title: 'Answered as a document', parentId }, projectId, {
        [CALL_HEADER]: 'http-plain',
        [MCP_SESSION_HEADER]: 'claude-code:journaled',
      });
      expect(plain.body).toMatchObject({ status: 'ok', block: { title: 'Answered as a document' }, journal: { from: expect.any(Number) } });
      expect((plain.body as { readonly _meta?: { readonly text?: unknown } })._meta?.text).toBeUndefined();
      const told = yield* answered('create_block', { title: 'Answered with its text', parentId }, projectId, {
        [CALL_HEADER]: 'http-told',
        [ANSWER_HEADER]: ANSWER_TEXT,
      });
      expect((told.body as { readonly _meta: { readonly text: string } })._meta.text).toContain('Answered with its text');
    }),
  );
  it.effect('an answer holding decoded domain objects crosses to JSON over the op road', () =>
    Effect.gen(function* () {
      const { world, projectId } = yield* Place;
      const born = yield* threadIn('trust');
      expect(born.status).toBe(200);
      const threadId = (born.body as { readonly snapshot: { readonly thread: { readonly id: string } } }).snapshot.thread.id;
      const graph = world.runtime.graph;
      const db = Context.get(graph, MachineStore).db;
      const units = Context.get(graph, MachineUnits);
      const runId = `${threadId}-run-0`;
      const at = Date.parse('2026-09-06T10:00:00.000Z');
      const usageJson = JSON.stringify(new Usage({ inputTokens: 5, outputTokens: 2 }));
      const readingJson = JSON.stringify({
        usage: new Usage({ inputTokens: 5, outputTokens: 2 }),
        contextWindow: null,
        runId,
        stepNumber: 1,
        provider: 'subscription',
        model: 'claude-opus-5-5',
        measuredAt: '2026-09-06T10:00:00.000Z',
        stale: false,
      });
      yield* Effect.provide(
        units.write('operationsDoor', (unit) =>
          unit.run(
            db.run(
              sql`insert into thread_run (id, thread_id, status, owner_id, provider, model, usage, finished_at, started_at, heartbeat_at, created_at, updated_at) values (${runId}, ${threadId}, 'completed', ${OPERATOR_PRINCIPAL}, 'subscription', 'claude-opus-5-5', ${usageJson}, ${at}, ${at}, ${at}, ${at}, ${at})`,
            ),
          ),
        ),
        world.runtime.owners,
      );
      yield* Effect.provide(
        units.write('operationsDoor', (unit) =>
          unit.run(
            db
              .update(thread())
              .set({ contextReading: JSON.parse(readingJson) })
              .where(eq(thread().id, threadId)),
          ),
        ),
        world.runtime.owners,
      );
      const shape = yield* perform('read_thread', { threadId }, projectId);
      expect(shape.status).toBe(200);
      const readUsage = (
        shape.body as {
          readonly shape: { readonly thread: { readonly contextReading: { readonly usage: { readonly inputTokens: number } } } };
        }
      ).shape.thread.contextReading.usage;
      expect(readUsage.inputTokens).toBe(5);
      const queried = yield* perform('read_thread', { threadId, select: 'runs' }, projectId);
      expect(queried.status).toBe(200);
      const evidence = (
        queried.body as {
          readonly evidence: {
            readonly threads: readonly unknown[];
            readonly rows: readonly [{ readonly usage: { readonly inputTokens: number } }];
          };
        }
      ).evidence;
      expect(evidence.threads).toEqual([{ threadId, head: expect.any(Number) }]);
      expect(evidence.rows[0].usage.inputTokens).toBe(5);
    }),
  );
  it.effect('an asked act of a thread leaves a standing question past the door deadline, and one answer is spent by one repeat', () =>
    Effect.gen(function* () {
      const { world, projectId } = yield* Place;
      const caller = yield* threadIn('trust');
      const callerId = (caller.body as { snapshot: { thread: { id: string } } }).snapshot.thread.id;
      const other = yield* threadIn('bypass');
      const otherId = (other.body as { snapshot: { thread: { id: string } } }).snapshot.thread.id;
      const grant = grantEnvironment(callerId, testSessionIdentity)[GRANT_VARIABLE] as string;
      const questions = Context.get(world.runtime.owners, ThreadHarness).runs.questions();
      const pin = (input: unknown) => answered('pin_thread', input, projectId, { [GRANT_HEADER]: grant, [APPROVAL_WAIT_HEADER]: '0' });
      const first = yield* pin({ threadId: otherId });
      expect(first).toMatchObject({ status: 409, body: { code: 'approval-pending' } });
      const [standing] = yield* questions.open(callerId);
      expect(standing?.action?.operation).toBe('pin_thread');
      expect((first.body as { reason: string }).reason).toContain(standing!.questionId);
      yield* questions.answer(callerId, standing!.questionId, [{ questionId: standing!.questionId, values: [THREAD_TOOL_CONFIRM_VALUE] }]);
      expect((yield* pin({ threadId: otherId })).status).toBe(200);
      expect(yield* pin({ threadId: otherId })).toMatchObject({ status: 409, body: { code: 'approval-pending' } });
      const [again] = yield* questions.open(callerId);
      expect(again?.questionId).not.toBe(standing!.questionId);
      expect(yield* pin({ threadId: otherId, pinned: false })).toMatchObject({ status: 409, body: { code: 'approval-pending' } });
      expect(yield* questions.open(callerId)).toHaveLength(2);
    }),
  );
});
