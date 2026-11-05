import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { eq } from 'drizzle-orm';
import { Clock, Context, Deferred, Effect, Layer, Stream } from 'effect';
import { subscriptionDescription } from '@runlith/builtin-catalog/subscription/description';
import type { LLMEvent } from '@runlith/llm/schema/events';
import { GRANT_HEADER } from '../../../platform/contract/service/credentials.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { grantFor } from '../../../platform/testing/grants.js';
import { APPROVAL_WAIT_HEADER, CALL_HEADER } from '../../../invocation/contract/wire/headers.js';
import { credentialMissing } from '../../../providers/credentials/missing.js';
import { ThreadRecords } from '../../../thread-record/contract/service/records.js';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import { birthsOf, threadRun, turnsOf } from '../../../threads/testing/doubles.js';
import { nativeLeads } from '../claudeLogin.js';
import { holdThreads } from '../threadScope.js';
import { ProtocolWorld, protocolWorld } from './protocolWorld.js';

type Answer = {
  readonly status?: string;
  readonly code?: string;
  readonly entries?: readonly {
    readonly question: string;
    readonly status: string;
    readonly text: string;
    readonly threadId: string | null;
  }[];
  readonly [field: string]: unknown;
};

const LEAD = 'Work out how the floor is built.';
const QUESTIONS = ['Where does the floor live?', 'What owns the beams?', 'Who laid the tiles?', 'How wide is the hall?'];
const FLOOR = 'The floor lives in floor/index.ts:1.';
const BEAMS = 'The frame module owns the beams; who maintains it I could not establish.';
const HALL = 'The hall is four metres wide.';
const CALL = 'ask-floor';

const toolCall = (id: string, name: string, input: unknown): Stream.Stream<LLMEvent> =>
  Stream.fromIterable<LLMEvent>([
    { type: 'step-start', index: 0 },
    { type: 'tool-input-start', id, name },
    { type: 'tool-call', id, name, input },
    { type: 'step-finish', index: 0, reason: 'tool-calls' },
    { type: 'finish', reason: 'tool-calls' },
  ]);

const said = (value: string): Stream.Stream<LLMEvent> =>
  Stream.fromIterable<LLMEvent>([
    { type: 'text-start', id: 'reply' },
    { type: 'text-delta', id: 'reply', text: value },
    { type: 'text-end', id: 'reply' },
    { type: 'finish', reason: 'stop' },
  ]);

const script: {
  hold: { readonly started: Deferred.Deferred<void>; seen: number } | null;
  asked: string | null;
} = {
  hold: null,
  asked: null,
};

const setup = Effect.gen(function* () {
  const context = yield* Layer.build(
    protocolWorld({
      name: 'ask-call',
      own: 'harness executables on PATH',
      models: (standing) => ({
        ...standing,
        request: (input) => ({
          ...standing.request(input),
          stream: (call) => {
            const asked = JSON.stringify(call.messages);
            const results = call.messages.flatMap((message) => message.content).filter((part) => part.type === 'tool-result');
            if (asked.includes(LEAD)) {
              const result = results.find((part) => part.id === CALL);
              if (result === undefined) return toolCall(CALL, 'ask', { questions: QUESTIONS });
              script.asked = JSON.stringify(result);
              return said('Asked.');
            }
            if (script.hold !== null) {
              script.hold.seen += 1;
              if (script.hold.seen === QUESTIONS.length) Deferred.doneUnsafe(script.hold.started, Effect.void);
              return Stream.never;
            }
            const question = QUESTIONS.findIndex((each) => asked.includes(each));
            if (question === 0) return said(FLOOR);
            if (question === 1) return said(BEAMS);
            if (question === 3) return said(HALL);
            return Stream.fail(credentialMissing('fixture provider failure'));
          },
        }),
      }),
    }),
  );
  const { world, projectId, changes } = Context.get(context, ProtocolWorld);
  const account = yield* Effect.acquireRelease(
    world.runtime.tokens.add('subscription', {
      accessToken: 'fixture-bearer',
      refreshToken: 'fixture-refresh',
      expiresAt: (yield* Clock.currentTimeMillis) + 3_600_000,
      scope: 'user:inference',
      account: { uuid: crypto.randomUUID(), email: 'fixture@example.com' },
      organization: { uuid: 'fixture-org', name: 'Fixture' },
    }),
    (key) => world.runtime.tokens.remove('subscription', key).pipe(Effect.orDie),
  );
  yield* nativeLeads(world, account);
  yield* holdThreads(world);
  return { world, account, projectId, changes };
});
class Place extends Context.Service<Place, Effect.Success<typeof setup>>()('testing/Ask') {}

const lead = Effect.fnUntraced(function* () {
  const { world, projectId, account } = yield* Place;
  return (yield* birthsOf(world.runtime.owners).create({ projectId, createdBySessionId: null, account, approvalMode: 'bypass' })).thread.id;
});

const readersOf = Effect.fnUntraced(function* (parent: string) {
  const { world } = yield* Place;
  const subtree = yield* Context.get(world.runtime.owners, ThreadRecords).subtree(parent);
  return subtree.filter((id) => id !== parent);
});

const runsOf = Effect.fnUntraced(function* (threadId: string) {
  const { world } = yield* Place;
  const db = Context.get(world.runtime.graph, MachineStore).db;
  return yield* Context.get(world.runtime.graph, MachineUnits).read((unit) =>
    unit.run(db.select().from(threadRun()).where(eq(threadRun().threadId, threadId)).all()),
  );
});

const idle = Effect.fnUntraced(function* (threadId: string) {
  const { world, changes } = yield* Place;
  const changed = yield* changes(threadId);
  const kernel = Context.get(world.runtime.owners, ThreadHarness);
  for (;;) {
    const state = yield* kernel.reads.snapshot(threadId);
    if (state.activeRun === null && state.latestRun != null) return;
    yield* changed;
  }
}, Effect.scoped);

layer(Layer.effect(Place, setup), { excludeTestServices: true })('ask', (it) => {
  it.effect('three questions in one tool call give one result in question order, with no report turn and the readers out of sight', () =>
    Effect.gen(function* () {
      const { world, projectId } = yield* Place;
      const asking = yield* lead();
      yield* turnsOf(world.runtime.owners).send(asking, projectId, LEAD, undefined, { key: 'ask-lead' });
      yield* idle(asking);
      const result = script.asked ?? '';
      expect(result).toContain('1. answered');
      expect(result.indexOf('2. answered')).toBeGreaterThan(result.indexOf('1. answered'));
      expect(result.indexOf('3. failed')).toBeGreaterThan(result.indexOf('2. answered'));
      expect(result.slice(result.indexOf('3. failed'))).toContain('fixture provider failure');
      expect(result).toContain('floor/index.ts:1');
      expect(result).toContain('I could not establish');
      expect(yield* runsOf(asking)).toHaveLength(1);
      const readers = yield* readersOf(asking);
      expect(readers).toHaveLength(QUESTIONS.length);
      const records = Context.get(world.runtime.owners, ThreadRecords);
      for (const reader of readers) expect((yield* records.facts(reader))?.archivedAt).toBeInstanceOf(Date);
      const listed = yield* world.op('list_threads', { set: 'all' }, `project=${projectId}`);
      expect(JSON.stringify(listed.body)).not.toContain(readers[0]!);
      const agents = yield* world.op('list_agents', {}, `project=${projectId}`, { [GRANT_HEADER]: grantFor(asking) });
      for (const reader of readers) expect(JSON.stringify(agents.body)).not.toContain(reader);
    }),
  );

  it.effect('stopping the caller leaves no reader running', () =>
    Effect.gen(function* () {
      const { world, projectId } = yield* Place;
      const started = yield* Deferred.make<void>();
      script.hold = { started, seen: 0 };
      const asking = yield* lead();
      yield* turnsOf(world.runtime.owners).send(asking, projectId, LEAD, undefined, { key: 'ask-stop' });
      yield* Deferred.await(started);
      const readers = yield* readersOf(asking);
      expect(readers).toHaveLength(QUESTIONS.length);
      const agents = yield* world.op('list_agents', {}, `project=${projectId}`, { [GRANT_HEADER]: grantFor(asking) });
      for (const reader of readers) expect(JSON.stringify(agents.body)).not.toContain(reader);
      yield* Context.get(world.runtime.owners, ThreadHarness).threads.handle(asking, 'operator').stop();
      for (const reader of readers) yield* idle(reader);
      script.hold = null;
    }),
  );

  it.effect('a reader gone before the caller stops leaves no other reader running', () =>
    Effect.gen(function* () {
      const { world, projectId } = yield* Place;
      const started = yield* Deferred.make<void>();
      script.hold = { started, seen: 0 };
      const asking = yield* lead();
      yield* turnsOf(world.runtime.owners).send(asking, projectId, LEAD, undefined, { key: 'ask-gone' });
      yield* Deferred.await(started);
      const readers = yield* readersOf(asking);
      expect((yield* world.op('delete_thread', { threadId: readers[0]! }, `project=${projectId}`)).body).toMatchObject({
        status: 'deleted',
      });
      yield* Context.get(world.runtime.owners, ThreadHarness).threads.handle(asking, 'operator').stop();
      for (const reader of readers.slice(1)) yield* idle(reader);
      script.hold = null;
    }),
  );

  it.effect('the operation a CLI thread calls through its grant gives the same shape', () =>
    Effect.gen(function* () {
      const { world, projectId } = yield* Place;
      const caller = yield* lead();
      const response = yield* world.op('ask', { questions: QUESTIONS }, `project=${projectId}`, {
        [GRANT_HEADER]: grantFor(caller),
        [APPROVAL_WAIT_HEADER]: '0',
        [CALL_HEADER]: 'ask-cli',
      });
      const answer = response.body as Answer;
      expect(answer).toMatchObject({ status: 'asked' });
      expect(answer.entries?.map((entry) => entry.status)).toEqual(['answered', 'answered', 'failed', 'answered']);
      expect(answer.entries?.map((entry) => entry.question)).toEqual(QUESTIONS);
      expect(answer.entries?.[3]?.text).toBe(HALL);
    }),
  );

  it.effect('a reader definition naming only a reasoning rung keeps the light model at that rung', () =>
    Effect.gen(function* () {
      const { world, projectId } = yield* Place;
      const query = `project=${projectId}`;
      const source =
        '---\ncapabilities: [files]\ntools: [read]\naudience: reader\nmodel: { reasoning: high }\n---\nAnswer the one question.\n';
      expect((yield* world.op('save_agent', { name: 'deep-reader', scope: 'project', revision: null, source }, query)).status).toBe(200);
      const offered = { key: 'agent.offered', value: [{ type: 'deep-reader', to: 'agents' }] };
      expect((yield* world.op('write_setting', offered, query)).status).toBe(200);
      const caller = yield* lead();
      const response = yield* world.op('ask', { questions: [QUESTIONS[0]], agent: 'deep-reader' }, query, {
        [GRANT_HEADER]: grantFor(caller),
        [APPROVAL_WAIT_HEADER]: '0',
        [CALL_HEADER]: 'ask-rung',
      });
      expect(response.body).toMatchObject({ status: 'asked' });
      const reader = (response.body as Answer).entries?.[0]?.threadId ?? '';
      const thread = ((yield* world.op('read_thread', { threadId: reader }, query)).body as { shape: { thread: Record<string, unknown> } })
        .shape.thread;
      expect(thread).toMatchObject({ model: subscriptionDescription.lightTextModel?.model, reasoning: 'high' });
    }),
  );
});
