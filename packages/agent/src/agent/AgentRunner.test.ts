import { recordRun, type RecordedInput, type RecordedRun } from './testing/recording';
import { RunStop } from './RunStop';
import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { createDeferred } from '@runlith/utils/async';
import { callerInThread } from './testing/caller';
import { builtinMode } from './testing/modes';
import { Cause, Clock, Deferred, Effect, Exit, Fiber, Schema, Stream } from 'effect';
import { AgentHostFailed, AgentResponseUnfinished, AgentRetryFailed } from './AgentFailure';
import { threadFailure } from '../thread/ThreadFailure';
import { continuationMessage } from './turn/continuation';
import { TestClock } from 'effect/testing';
import { makeAgentRunner, type AgentRunInput } from './AgentRunner';
import { Tool, ToolFailed } from './tool';
import type { ModelRequest, ModelRequester, ModelRequestInput, ModelStreamInput } from './modelPort';
import { Agent } from './Agent';
import {
  AuthenticationReason,
  InvalidProviderOutputReason,
  InvalidRequestReason,
  LLMError,
  ProviderInternalReason,
  RateLimitReason,
  StreamStalledReason,
  UnknownProviderReason,
} from '@runlith/llm/schema/errors';
import { Message } from '@runlith/llm/schema/messages';
import { ModelID, ProviderID, type FinishReason } from '@runlith/llm/schema/ids';
import { ModelIdentity } from '@runlith/llm/schema/options';
import { Usage, type LLMEvent } from '@runlith/llm/schema/events';
import type { AgentAside } from './AgentAside';
import type { AgentContext } from './AgentContext';
import type { AgentEvent } from './AgentEvent';
import { agentCatalog, agentScope } from './AgentScope';
import type { ToolCatalog } from './ToolCatalog';
import { ActivityLog } from '@runlith/activity/log';
import { activityRecording } from '@runlith/activity/testing';
import { agentRule } from './policy/AgentRuntimePolicy';
import { stepLimit } from './AgentStep';
import { type AgentSkillPool, agentSkillRule, agentSkillTools } from './AgentSkill';
import { LOAD_SKILL_TOOL } from './skillWords';
import type { AgentToolOutputs } from './ToolOutput';
import type { ThreadSignal } from '../transcript/parts';
import { agentSkillRequestRule } from './agentSkillRequests';
import { agentInputSkills, agentOriginOf } from './AgentSignal';
import { skillReferences } from './skillReferences';
import { projectThreadHistory } from '../thread/compaction/projection';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../permissions/vocabulary';
describe('AgentRunner recording', () => {
  it.live.each(['run-start', 'text-delta', 'run-finish'])(
    'recorder failure at %s rejects every result without hanging',
    Effect.fnUntraced(function* (at) {
      const native = yield* makeAgentRunner({
        models: { request: () => fakeModel(() => textTurn('Recorded.')).request },
        idleMs: TEST_IDLE_MS,
      });
      const failure = new Error('recording failed');
      const handle = yield* native.run(
        agent(),
        {
          runId: 'failed-recorder',
          stop: new RunStop(),
          ctx: {},
          model: { ownerId: 'owner', provider: 'test', model: null, reasoning: null, switches: {} },
          messages: [],
          approval: { mode: 'trust', interactive: false },
          modeOf: builtinMode('trust'),
        },
        { push: (event) => (event.type === at ? Effect.die(failure) : Effect.void) },
      );
      const failures = yield* Effect.all([
        Effect.flip(handle.output.text),
        Effect.flip(handle.output.steps),
        Effect.flip(handle.output.usage),
        Effect.flip(handle.output.response),
        Effect.flip(handle.output.finishReason),
      ]);
      expect(failures.map((broke) => broke.cause)).toEqual(Array(5).fill(failure));
    }),
  );
  it.live.each([false, true])(
    'a run releases what its model requests pinned once it ends, broken or not (broken: %p)',
    Effect.fnUntraced(function* (broken) {
      const released: string[] = [];
      const native = yield* makeAgentRunner({
        models: { request: () => fakeModel(() => textTurn('Recorded.')).request },
        idleMs: TEST_IDLE_MS,
        released: (runId) => Effect.sync(() => void released.push(runId)),
      });
      const handle = yield* native.run(
        agent(),
        {
          runId: 'pinned-run',
          stop: new RunStop(),
          ctx: {},
          model: { ownerId: 'owner', provider: 'test', model: null, reasoning: null, switches: {} },
          messages: [],
          approval: { mode: 'trust', interactive: false },
          modeOf: builtinMode('trust'),
        },
        { push: (event) => (broken && event.type === 'text-delta' ? Effect.die(new Error('recording failed')) : Effect.void) },
      );
      yield* Effect.exit(handle.output.finishReason);
      expect(released).toEqual([]);
      yield* handle.close();
      expect(released).toEqual(['pinned-run']);
    }),
  );
  it.live(
    'a blocked recorder stops the producer before it commits the step',
    Effect.fnUntraced(function* () {
      const native = yield* makeAgentRunner({
        models: { request: () => fakeModel(() => textTurn('Recorded.')).request },
        idleMs: TEST_IDLE_MS,
      });
      const reached = Deferred.makeUnsafe<void>();
      const release = Deferred.makeUnsafe<void>();
      yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined));
      const events: string[] = [];
      const handle = yield* native.run(
        agent(),
        {
          runId: 'slow-recorder',
          stop: new RunStop(),
          ctx: {},
          model: { ownerId: 'owner', provider: 'test', model: null, reasoning: null, switches: {} },
          messages: [],
          approval: { mode: 'trust', interactive: false },
          modeOf: builtinMode('trust'),
        },
        {
          push: Effect.fnUntraced(function* (event) {
            if (event.type === 'text-delta') {
              yield* Deferred.succeed(reached, undefined);
              yield* Deferred.await(release);
            }
            events.push(event.type);
          }),
        },
      );
      yield* Deferred.await(reached);
      expect(handle.completedSteps()).toEqual([]);
      expect(events.at(-1)).toBe('text-start');
      Deferred.doneUnsafe(release, Effect.void);
      expect(yield* handle.output.text).toBe('Recorded.');
      expect(events.filter((type) => type === 'text-delta')).toHaveLength(1);
      expect(events.at(-1)).toBe('run-finish');
    }),
  );
  it.live(
    'the run completes only after its ordered output has reached the recorder',
    Effect.fnUntraced(function* () {
      const events: import('./AgentRunner').AgentEmission[] = [];
      const native = yield* makeAgentRunner({
        models: { request: () => fakeModel(() => textTurn('Recorded.')).request },
        idleMs: TEST_IDLE_MS,
      });
      const handle = yield* native.run(
        agent(),
        {
          runId: 'recorded',
          stop: new RunStop(),
          ctx: {},
          model: { ownerId: 'owner', provider: 'test', model: null, reasoning: null, switches: {} },
          messages: [],
          approval: { mode: 'trust', interactive: false },
          modeOf: builtinMode('trust'),
        },
        {
          push: (event) =>
            Effect.sync(() => {
              events.push(event);
            }),
        },
      );
      expect(yield* handle.output.text).toBe('Recorded.');
      expect(events.filter((event) => event.type === 'text-delta')).toEqual([{ type: 'text-delta', id: 'text-1', text: 'Recorded.' }]);
      expect(events[0]?.type).toBe('run-start');
      expect(events.at(-1)?.type).toBe('run-finish');
    }),
  );
});
describe('AgentRunner run door', () => {
  const ask = (door: RecordedRun['door']) =>
    Effect.exit(
      door.verdict({
        name: 'late',
        tool: Tool.make({
          display: () => ({ form: 'none' }),
          approval: ASKS_NEVER,
          description: 'Arrive late.',
          parameters: Schema.Struct({}),
          execute: () => Effect.succeed({}),
        }),
        input: {},
        toolCallId: 'late-1',
      }),
    );
  it.live.each(['native', 'hosted'] as const)(
    'closing the caller scope ends an unclosed %s door and releases its run once',
    Effect.fnUntraced(function* (kind) {
      const released: string[] = [];
      const handle = yield* Effect.scoped(
        Effect.gen(function* () {
          const native = yield* makeAgentRunner({
            models: { request: () => fakeModel(() => textTurn('Done.')).request },
            idleMs: TEST_IDLE_MS,
            released: (runId) =>
              Effect.sync(() => {
                released.push(runId);
              }),
          });
          const input = {
            runId: 'run-unclosed',
            stop: new RunStop(),
            ctx: {},
            model: { ownerId: 'owner-1', provider: 'openai-oauth', model: 'gpt-5.5', reasoning: 'high', switches: {} },
            messages: [Message.user('Answer.')],
            approval: { mode: 'trust', interactive: false },
            modeOf: builtinMode('trust'),
          } satisfies AgentRunInput<Record<string, never>>;
          const handle =
            kind === 'native'
              ? yield* Effect.tap(recordRun(native, agent(), input), (run) => run.output.text)
              : yield* native.host(agent(), input);
          expect((yield* ask(handle.door))._tag).toBe('Success');
          return handle;
        }),
      );
      expect((yield* ask(handle.door))._tag).toBe('Failure');
      expect(released).toEqual(['run-unclosed']);
      yield* handle.close();
      expect(released).toEqual(['run-unclosed']);
    }),
  );
});
describe('AgentRunner activity', () => {
  it.live(
    'a completed run records one run activity under its run id, ended ok with its finish',
    Effect.fnUntraced(function* () {
      const recording = activityRecording();
      const model = fakeModel(() => textTurn('Done.'));
      const handle = yield* runner(model, recording.log).run(agent(), {
        runId: 'run-recorded',
        caller: callerInThread('thread-recorded', 'run-recorded'),
        ctx: {},
        model: {
          ownerId: 'owner-1',
          provider: 'openai-oauth',
          model: 'gpt-5.5',
          reasoning: 'high' as const,
          switches: { serviceTier: 'priority' },
        },
        messages: [Message.user('Answer.')],
        approval: { mode: 'trust', interactive: false },
        modeOf: builtinMode('trust'),
      });
      expect(yield* handle.output.text).toBe('Done.');
      expect(model.selections.map((selection) => selection.switches)).toEqual([{ serviceTier: 'priority' }]);
      yield* until(() => recording.activities().some((recorded) => recorded.opened.kind === 'run' && recorded.ended !== null));
      const runs = recording.activities().filter((recorded) => recorded.opened.kind === 'run');
      expect(runs).toHaveLength(1);
      expect(runs[0]?.opened).toMatchObject({
        run: 'run-recorded',
        thread: 'thread-recorded',
        parent: null,
        actor: { kind: 'thread', id: 'thread-recorded' },
        attrs: { provider: 'openai-oauth', model: 'gpt-5.5', reasoning: 'high' },
      });
      expect(runs[0]?.ended).toMatchObject({ outcome: 'ok', result: { finish: 'stop' } });
    }),
  );
  it.live(
    'a tool call keeps the argument text the model streamed and the output text the model was shown',
    Effect.fnUntraced(function* () {
      const recording = activityRecording();
      const streamed = ['{ "path" :', ' "notes.md" }'];
      const model = fakeModel((callNumber) =>
        callNumber === 1
          ? {
              events: [
                { type: 'step-start', index: 0 },
                { type: 'tool-input-start', id: 'call-read', name: 'read' },
                ...streamed.map((text) => ({ type: 'tool-input-delta' as const, id: 'call-read', name: 'read', text })),
                { type: 'tool-input-end', id: 'call-read', name: 'read' },
                { type: 'tool-call', id: 'call-read', name: 'read', input: { path: 'notes.md' } },
                { type: 'step-finish', index: 0, reason: 'tool-calls' },
                finished('tool-calls'),
              ],
            }
          : textTurn('Done.'),
      );
      const reading = new Agent<Record<string, never>>({
        id: 'reading-agent',
        name: 'Reading agent',
        description: 'Reads one file.',
        stopWhen: [stepLimit(TEST_MAX_STEPS)],
        instructions: () => 'Read the notes.',
        tools: () => ({
          read: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_NEVER,
            description: 'Read a file.',
            parameters: Schema.Struct({ path: Schema.String }),
            execute: (input) => Effect.succeed(`contents of ${input.path}`),
          }),
        }),
      });
      const handle = yield* runner(model, recording.log).run(reading, {
        runId: 'run-bodies',
        caller: callerInThread('thread-bodies', 'run-bodies'),
        ctx: {},
        model: { ownerId: 'owner-1', provider: 'openai-oauth', model: 'gpt-5.5', reasoning: 'high', switches: {} },
        messages: [Message.user('Read.')],
        approval: { mode: 'trust', interactive: false },
        modeOf: builtinMode('trust'),
      });
      expect(yield* handle.output.text).toBe('Done.');
      yield* until(() => recording.activities().some((recorded) => recorded.opened.kind === 'tool-call' && recorded.ended !== null));
      const call = recording.activities().find((recorded) => recorded.opened.kind === 'tool-call')!;
      const bodies = recording.facts.flatMap((fact) =>
        fact._tag === 'Bodied' && fact.activity === call.opened.id
          ? [[fact.body.kind, fact.body.contentType, new TextDecoder().decode(fact.body.encoded)]]
          : [],
      );
      expect(bodies).toEqual([
        ['input', 'application/json', streamed.join('')],
        ['result', 'text/plain; charset=utf-8', 'contents of notes.md'],
      ]);
    }),
  );
  it.live(
    "a broken call ends the run's activity failed",
    Effect.fnUntraced(function* () {
      const recording = activityRecording();
      const handle = yield* runner(
        fakeModel(() => ({ events: [], failure: doorFailure('the upstream fell over') })),
        recording.log,
      ).run(agent(), {
        runId: 'run-broken',
        ctx: {},
        model: { ownerId: 'owner-1', provider: 'openai-oauth', model: 'gpt-5.5', reasoning: 'high', switches: {} },
        messages: [Message.user('Answer.')],
        approval: { mode: 'trust', interactive: false },
        modeOf: builtinMode('trust'),
      });
      yield* streamCause(handle);
      yield* until(() => recording.activities().some((recorded) => recorded.opened.kind === 'run' && recorded.ended !== null));
      const run = recording.activities().find((recorded) => recorded.opened.kind === 'run');
      expect(run?.ended?.outcome).toBe('failed');
    }),
  );
});
describe('AgentRunner capture', () => {
  it.live(
    'an aside after the run carries its sent prefix and lowered final answer, while the first-output aside carries the prefix alone',
    Effect.fnUntraced(function* () {
      const model = fakeModel((call) => textTurn(call === 1 ? 'Final answer.' : 'Aside reply.'));
      const captures: AgentAside[] = [];
      const openings: AgentAside[] = [];
      const handle = yield* runner(model).run(agent(), {
        runId: 'run-captured',
        ctx: {},
        model: { ownerId: 'owner-1', provider: 'openai-oauth', model: 'gpt-5.5', reasoning: 'high', switches: {} },
        messages: [Message.user('Answer.')],
        approval: { mode: 'trust', interactive: false },
        modeOf: builtinMode('trust'),
        context: {
          project: (input) => Effect.succeed({ messages: input.messages }),
          lower: (messages) =>
            Effect.succeed(
              messages.map((message) => (message.role === 'assistant' ? Message.assistant('Final answer, lowered.') : message)),
            ),
          observe: () => Effect.succeed(undefined),
        },
        capture: (aside) => Effect.sync(() => void captures.push(aside)),
        aside: (aside) => Effect.sync(() => void openings.push(aside)),
      });
      expect(yield* handle.output.text).toBe('Final answer.');
      const opening = openings[0];
      const [completed] = captures;
      if (completed === undefined || opening === undefined || captures.length !== 1)
        return yield* Effect.die(new Error('the run left no single capture'));
      const asking = { instruction: 'Summarize.' };
      expect((yield* completed.ask(asking)).text).toBe('Aside reply.');
      yield* opening.ask(asking);
      const [sent, afterRun, atFirstOutput] = model.calls.map((call) => [...call.messages]);
      const said = (message: Message) => message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('');
      expect(afterRun?.slice(0, sent?.length)).toEqual(sent);
      expect(afterRun?.slice(sent?.length).map((message) => [message.role, said(message)])).toEqual([
        ['assistant', 'Final answer, lowered.'],
        ['user', 'Summarize.'],
      ]);
      expect(atFirstOutput?.slice(sent?.length).map((message) => message.role)).toEqual(['user']);
      expect(completed.sentAt).not.toBeNull();
      expect(completed.measuredAt).toBeGreaterThanOrEqual(completed.sentAt ?? Number.POSITIVE_INFINITY);
      expect(opening.measuredAt).toBeNull();
    }),
  );
});
describe('AgentRunner cancellation', () => {
  it.live(
    'a silent provider is reported as calling before it can answer',
    Effect.fnUntraced(function* () {
      const model = fakeModel(() => ({ events: [], ending: 'parks' }));
      const handle = yield* runner(model).run(agent(), {
        runId: 'run-phase',
        ctx: {},
        model: { ownerId: 'owner-1', provider: 'openai-oauth', model: 'gpt-5.5', reasoning: 'high', switches: {} },
        messages: [Message.user('Answer.')],
        approval: { mode: 'trust', interactive: false },
        modeOf: builtinMode('trust'),
      });
      yield* Effect.addFinalizer(() => Effect.andThen(handle.stop(new Error('test complete')), Effect.asVoid(streamCause(handle))));
      const announced = yield* handle.recording.stream().pipe(
        Stream.filter((event) => event.type === 'phase' && event.phase === 'calling'),
        Stream.take(1),
        Stream.runCollect,
      );
      expect(announced[0]).toEqual({ type: 'phase', phase: 'calling' });
      expect(handle.completedSteps()).toEqual([]);
    }),
  );
  it.live(
    'a run whose provider says nothing settles the moment the caller stops it',
    Effect.fnUntraced(function* () {
      const silent: ModelRequest = {
        plannedOutputTokens: 32_000,
        origin: FAKE_ORIGIN,
        text: () => {
          throw new Error('the loop never opens a one-shot');
        },
        object: () => {
          throw new Error('the loop never opens a one-shot');
        },
        stream: () => Stream.never as unknown as Stream.Stream<LLMEvent, LLMError>,
      };
      const handle = yield* recordRun(yield* makeAgentRunner({ models: { request: () => silent }, idleMs: TEST_IDLE_MS }), agent(), {
        runId: 'run-silent',
        ctx: {},
        model: { ownerId: 'owner-1', provider: 'openai-oauth', model: 'gpt-5.5', reasoning: 'high', switches: {} },
        messages: [Message.user('Answer.')],
        approval: { mode: 'trust', interactive: false },
        modeOf: builtinMode('trust'),
      });
      const settled = yield* Effect.forkChild(Effect.exit(handle.output.steps), { startImmediately: true });
      const drained = yield* Effect.forkChild(Effect.exit(Stream.runDrain(handle.recording.stream())), { startImmediately: true });
      yield* handle.stop(new Error('stopped by the reader'));
      const outcome = yield* Fiber.join(settled);
      const recording = yield* Fiber.join(drained);
      expect(Exit.isFailure(outcome)).toBe(true);
      expect(Exit.isFailure(recording)).toBe(true);
    }),
  );
});
describe('a stop on the run’s own RunStop ends the run wherever its step waits, with no timer between', () => {
  const input = (runId: string, stop: RunStop): RecordedInput<Record<string, never>> => ({
    runId,
    stop,
    ctx: {},
    model: { ownerId: 'owner-1', provider: 'openai-oauth', model: 'gpt-5.5', reasoning: 'high', switches: {} },
    messages: [Message.user('Answer.')],
    approval: { mode: 'trust', interactive: false },
    modeOf: builtinMode('trust'),
  });
  const stoppedAt = Effect.fnUntraced(function* (handle: RecordedRun, stop: RunStop, reached: Effect.Effect<void>) {
    yield* reached;
    const reason = new Error('The operator pressed Esc.');
    stop.stop(reason);
    expect(yield* Effect.flip(handle.output.text)).toMatchObject({ cause: reason });
  });
  it.effect(
    'in the model stream, which it closes',
    Effect.fnUntraced(function* () {
      const opened = yield* Deferred.make<void>();
      const model = fakeModel(() => parkedTurn(() => Deferred.doneUnsafe(opened, Effect.void)));
      const stop = new RunStop();
      const handle = yield* runner(model).run(agent(), input('run-stopped-streaming', stop));
      yield* stoppedAt(handle, stop, Deferred.await(opened));
      expect(model.calls[0]?.interrupted).toBe(true);
    }),
  );
  it.effect(
    'in a rule the step evaluates',
    Effect.fnUntraced(function* () {
      const evaluating = yield* Deferred.make<void>();
      const stop = new RunStop();
      const handle = yield* runner(fakeModel(() => textTurn('Unreached.'))).run(agent(), {
        ...input('run-stopped-in-rule', stop),
        rules: [
          agentRule('slow-step-rule', () => Deferred.succeed(evaluating, undefined).pipe(Effect.andThen(Effect.never)), {
            owner: 'test',
            hook: 'beforeStep',
          }),
        ],
      });
      yield* stoppedAt(handle, stop, Deferred.await(evaluating));
    }),
  );
  it.effect(
    'in the journal write of the words the step reads, which it lets land and then ends before the model',
    Effect.fnUntraced(function* () {
      const writing = yield* Deferred.make<void>();
      const landed = yield* Deferred.make<void>();
      const model = fakeModel(() => textTurn('Unreached.'));
      const stop = new RunStop();
      const handle = yield* runner(model).run(agent(), {
        ...input('run-stopped-reading-words', stop),
        signals: {
          drain: () =>
            Effect.uninterruptible(Deferred.succeed(writing, undefined).pipe(Effect.andThen(Deferred.await(landed)), Effect.as([]))),
          hasPending: () => Effect.succeed(true),
        },
      });
      yield* Deferred.await(writing);
      const reason = new Error('The operator pressed Esc.');
      stop.stop(reason);
      yield* Deferred.succeed(landed, undefined);
      expect(yield* Effect.flip(handle.output.text)).toMatchObject({ cause: reason });
      expect(model.calls).toHaveLength(0);
    }),
  );
  const holding = (execute: Effect.Effect<string>) =>
    new Agent<Record<string, never>>({
      id: 'holding-agent',
      name: 'Holding agent',
      description: 'Holds a resource it gives back slowly.',
      stopWhen: [stepLimit(TEST_MAX_STEPS)],
      instructions: () => 'Hold.',
      tools: () => ({
        hold: Tool.make({
          display: () => ({ form: 'none' }),
          approval: ASKS_NEVER,
          description: 'Hold a resource.',
          parameters: Schema.Struct({}),
          execute: () => execute,
        }),
      }),
    });
  it.effect(
    'in the claims of a tool, answering the call as never started',
    Effect.fnUntraced(function* () {
      const claiming = yield* Deferred.make<void>();
      let ran = false;
      const claimed = new Agent<Record<string, never>>({
        id: 'claiming-agent',
        name: 'Claiming agent',
        description: 'Claims what it touches slowly.',
        stopWhen: [stepLimit(TEST_MAX_STEPS)],
        instructions: () => 'Touch it.',
        tools: () => ({
          touch: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_NEVER,
            description: 'Touch one file.',
            parameters: Schema.Struct({}),
            claims: () => Deferred.succeed(claiming, undefined).pipe(Effect.andThen(Effect.never)),
            execute: () => Effect.sync(() => (ran = true)),
          }),
        }),
      });
      const stop = new RunStop();
      const handle = yield* runner(fakeModel(() => toolCallTurn('touch', 'call-touch'))).run(claimed, input('run-stopped-claiming', stop));
      yield* stoppedAt(handle, stop, Deferred.await(claiming));
      expect(ran).toBe(false);
      expect(handle.recording.entries().filter((event) => event.type === 'tool-outcome')).toMatchObject([
        { toolCallId: 'call-touch', outcome: { kind: 'cancelled' } },
      ]);
    }),
  );
  it.effect.each([
    { at: 'while it runs', answered: 'cancelled', returns: false },
    { at: 'after it answered', answered: 'answered', returns: true },
  ] as const)(
    'in a tool whose release is slow, stopped $at, keeping the answer its door gave',
    Effect.fnUntraced(function* ({ answered, returns }) {
      const running = yield* Deferred.make<void>();
      const releasing = yield* Deferred.make<void>();
      const released = yield* Deferred.make<void>();
      const stop = new RunStop();
      const execute = Deferred.succeed(running, undefined).pipe(Effect.andThen(returns ? Effect.succeed('held') : Effect.never));
      const handle = yield* runner(fakeModel(() => toolCallTurn('hold', 'call-hold'))).run(holding(execute), {
        ...input('run-stopped-releasing', stop),
        callHooks: () => ({
          retain: () => Effect.succeed({ release: Deferred.succeed(releasing, undefined).pipe(Effect.andThen(Deferred.await(released))) }),
          completed: () => Effect.void,
        }),
      });
      yield* Effect.addFinalizer(() => Deferred.succeed(released, undefined));
      yield* stoppedAt(handle, stop, Deferred.await(returns ? releasing : running));
      expect(handle.recording.entries().filter((event) => event.type === 'tool-outcome')).toMatchObject([
        { toolCallId: 'call-hold', outcome: { kind: answered } },
      ]);
    }),
  );
});
describe('AgentRunner phase', () => {
  it.live(
    'a run announces each phase it enters, in order, across steps',
    Effect.fnUntraced(function* () {
      const thought = (id: string): LLMEvent[] => [
        { type: 'reasoning-start', id },
        { type: 'reasoning-delta', id, text: 'Weighing it.' },
        { type: 'reasoning-end', id },
      ];
      const said = (id: string, text: string): LLMEvent[] => [
        { type: 'text-start', id },
        { type: 'text-delta', id, text },
        { type: 'text-end', id },
      ];
      const model = fakeModel((callNumber) => ({
        paceMs: 1_000,
        events:
          callNumber === 1
            ? [
                { type: 'step-start', index: 0 },
                ...thought('r-1'),
                ...thought('r-2'),
                ...said('text-1', 'Changing it.'),
                ...toolEvents('side_effect', 'call-1', {}),
                { type: 'step-finish', index: 0, reason: 'tool-calls' },
                finished('tool-calls'),
              ]
            : [
                { type: 'step-start', index: 0 },
                ...thought('r-3'),
                ...said('text-2', 'Done.'),
                { type: 'step-finish', index: 0, reason: 'stop' },
                finished('stop'),
              ],
      }));
      const native = yield* makeAgentRunner({ models: { request: () => model.request }, idleMs: TEST_IDLE_MS });
      const frames = yield* Effect.gen(function* () {
        const handle = yield* recordRun(
          native,
          sideEffectAgent(() => 'done'),
          {
            runId: 'run-spells',
            ctx: {},
            model: { ownerId: 'owner-1', provider: 'openai-oauth', model: 'gpt-5.5', reasoning: 'high', switches: {} },
            messages: [Message.user('Change it.')],
            approval: { mode: 'trust', interactive: false },
            modeOf: builtinMode('trust'),
          },
        );
        yield* TestClock.adjust('1 minute');
        expect(yield* handle.output.text).toBe('Done.');
        const events = yield* Stream.runCollect(handle.recording.stream());
        return events.flatMap((event) => (event.type === 'phase' ? [event.phase] : []));
      }).pipe(Effect.provide(TestClock.layer()));
      expect(frames).toEqual([
        'preparing',
        'calling',
        'reasoning',
        'calling',
        'reasoning',
        'calling',
        'writing',
        'calling',
        'tools',
        'tools',
        'preparing',
        'calling',
        'reasoning',
        'calling',
        'writing',
        'calling',
      ]);
    }),
  );
});
describe('what a run hands back', () => {
  it.live(
    'names the model that produced it, on the assistant message and on the tool message beside it',
    Effect.fnUntraced(function* () {
      const handle = yield* runner(fakeModel(() => toolCallTurn('side_effect', 'call-1'))).run(
        terminalToolAgent(() => 'done'),
        {
          runId: 'run-origin',
          ctx: {},
          model: { ownerId: 'owner-1', provider: 'openai-oauth', model: 'gpt-5.5', reasoning: 'high', switches: {} },
          messages: [Message.user('Run the tool once.')],
          approval: { mode: 'trust', interactive: false },
          modeOf: builtinMode('trust'),
        },
      );
      const { messages } = yield* handle.output.response;
      expect(messages.map((message) => message.role)).toEqual(['assistant', 'tool']);
      expect(messages.map((message) => message.origin)).toEqual([FAKE_ORIGIN, FAKE_ORIGIN]);
    }),
  );
});
describe('AgentRunner authentication recovery', () => {
  it.live(
    'authentication after an ordinary retry recovers the bearer from the request that was rejected',
    Effect.fnUntraced(function* () {
      const busy = new LLMError({ module: 'wire', method: 'send', reason: new RateLimitReason({ message: 'Busy', retryAfterMs: 0 }) });
      const rejected = new LLMError({
        module: 'wire',
        method: 'send',
        reason: new AuthenticationReason({
          message: 'Rejected',
          kind: 'invalid',
          http: {
            request: { method: 'POST', url: 'https://provider.test/model', headers: {} },
            response: { status: 401, headers: {} },
          },
        }),
      });
      let recovered = false;
      const model = fakeModel((number) =>
        number === 1
          ? { events: [], failure: busy }
          : recovered
            ? textTurn('Recovered current request.')
            : { events: [], failure: rejected },
      );
      let requests = 0;
      const native = yield* makeAgentRunner({
        models: {
          request: () => {
            const current = ++requests;
            return {
              ...model.request,
              retry: {
                recover:
                  current === 1
                    ? Effect.fail(busy)
                    : Effect.sync(() => {
                        recovered = true;
                      }),
              },
            };
          },
        },
        idleMs: TEST_IDLE_MS,
      });
      const handle = yield* recordRun(native, agent(), {
        runId: 'auth-after-retry',
        ctx: {},
        model: { ownerId: 'owner', provider: 'test', model: 'test', reasoning: null, switches: {} },
        messages: [Message.user('Answer.')],
        approval: { mode: 'trust', interactive: false },
        modeOf: builtinMode('trust'),
      });
      expect(yield* handle.output.text).toBe('Recovered current request.');
      expect(model.calls).toHaveLength(3);
    }),
  );
  it.live.each(['changed', 'rejected', 'refused'] as const)(
    'replays only a recovered bearer and stops after one authentication replay: %s',
    Effect.fnUntraced(function* (outcome) {
      const rejected = new LLMError({
        module: 'wire',
        method: 'send',
        reason: new AuthenticationReason({
          message: 'Rejected',
          kind: 'invalid',
          http: {
            request: { method: 'POST', url: 'https://provider.test/model', headers: {} },
            response: { status: 401, headers: {} },
          },
        }),
      });
      const reconnect = new LLMError({
        module: 'Auth',
        method: 'recover',
        reason: new AuthenticationReason({ message: 'Reconnect', kind: 'expired' }),
      });
      let bearer = 'old';
      const sent: string[] = [];
      const model = fakeModel(() => {
        sent.push(bearer);
        return bearer === 'fresh' && outcome === 'changed' ? textTurn('Recovered.') : { events: [], failure: rejected };
      });
      const retry = {
        recover:
          outcome === 'refused'
            ? Effect.fail(reconnect)
            : Effect.sync(() => {
                bearer = 'fresh';
              }),
      };
      const handle = yield* runner({ ...model, request: { ...model.request, retry } }).run(agent(), {
        runId: `auth-${outcome}`,
        ctx: {},
        model: { ownerId: 'owner', provider: 'test', model: 'test', reasoning: null, switches: {} },
        messages: [Message.user('Answer.')],
        approval: { mode: 'trust', interactive: false },
        modeOf: builtinMode('trust'),
      });
      if (outcome === 'changed') expect(yield* handle.output.text).toBe('Recovered.');
      else if (outcome === 'refused') expect(yield* streamCause(handle)).toBe(reconnect);
      else expect(yield* streamCause(handle)).toMatchObject({ cause: { reason: { _tag: 'Authentication', kind: 'expired' } } });
      expect(sent).toEqual(outcome === 'refused' ? ['old'] : ['old', 'fresh']);
    }),
  );
});
describe('AgentRunner context overflow recovery', () => {
  it.live(
    'recovers an oversized request after a gateway retry',
    Effect.fnUntraced(function* () {
      const gateway = new LLMError({
        module: 'Provider',
        method: 'stream',
        reason: new ProviderInternalReason({ message: 'Bad Gateway', status: 502 }),
      });
      const compacted = [Message.user('Anchored state plus the latest turn.')];
      const model = fakeModel((callNumber) => {
        if (callNumber === 1) return { events: [], failure: gateway };
        return JSON.stringify(model.calls.at(-1)?.messages) === JSON.stringify(compacted)
          ? textTurn('Recovered after compaction.')
          : contextOverflowTurn();
      });
      const native = yield* makeAgentRunner({ models: { request: () => model.request }, idleMs: TEST_IDLE_MS });
      yield* Effect.gen(function* () {
        const handle = yield* recordRun(native, agent(), {
          runId: 'run-gateway-overflow',
          ctx: {},
          model: { ownerId: 'owner-1', provider: 'subscription', model: 'claude-opus-5-5', reasoning: 'high', switches: {} },
          messages: [Message.user('Oversized history.')],
          approval: { mode: 'trust', interactive: false },
          modeOf: builtinMode('trust'),
          context: projecting((input) => Effect.succeed({ messages: input.contextOverflow ? compacted : input.messages })),
        });
        yield* TestClock.adjust('10 seconds');
        expect(yield* handle.output.text).toBe('Recovered after compaction.');
        expect(handle.completedSteps()).toHaveLength(1);
        const events = yield* Stream.runCollect(handle.recording.stream());
        expect(events.filter((event) => event.type === 'step-start')).toHaveLength(1);
      }).pipe(Effect.provide(TestClock.layer()));
    }),
  );
  it.live.each(['before', 'after'] as const)(
    'recovers overflow only once with a gateway failure %s recovery',
    Effect.fnUntraced(function* (position) {
      const overflow = contextOverflow();
      const gateway = new LLMError({
        module: 'Provider',
        method: 'stream',
        reason: new ProviderInternalReason({ message: 'Bad Gateway', status: 502 }),
      });
      const model = fakeModel((callNumber) => ({
        events: [],
        failure: callNumber === (position === 'before' ? 1 : 2) ? gateway : overflow,
      }));
      const native = yield* makeAgentRunner({ models: { request: () => model.request }, idleMs: TEST_IDLE_MS });
      yield* Effect.gen(function* () {
        const handle = yield* recordRun(native, agent(), {
          runId: `run-bounded-overflow-${position}`,
          ctx: {},
          model: { ownerId: 'owner-1', provider: 'subscription', model: 'claude-opus-5-5', reasoning: 'high', switches: {} },
          messages: [Message.user('Oversized latest turn.')],
          approval: { mode: 'trust', interactive: false },
          modeOf: builtinMode('trust'),
          context: projecting((input) => Effect.succeed({ messages: input.messages })),
        });
        yield* TestClock.adjust('10 seconds');
        const failure = yield* Effect.flip(handle.output.text);
        expect(failure.cause).toMatchObject({
          cause: overflow,
          retry: { stop: 'not-retryable', attempts: 3, retries: 1 },
        });
        expect(handle.completedSteps()).toEqual([]);
        expect(model.calls).toHaveLength(3);
      }).pipe(Effect.provide(TestClock.layer()));
    }),
  );
  it.live(
    'does not compact a retry after the step has already exposed output',
    Effect.fnUntraced(function* () {
      const overflow = contextOverflow();
      const model = fakeModel((callNumber) =>
        callNumber === 1
          ? failedTextTurn('Partial reply.', tornStream())
          : callNumber === 2
            ? contextOverflowTurn(overflow)
            : textTurn('Unexpected replay.'),
      );
      const native = yield* makeAgentRunner({ models: { request: () => model.request }, idleMs: TEST_IDLE_MS });
      yield* Effect.gen(function* () {
        const handle = yield* recordRun(native, agent(), {
          runId: 'run-partial-overflow',
          ctx: {},
          model: { ownerId: 'owner-1', provider: 'subscription', model: 'claude-opus-5-5', reasoning: 'high', switches: {} },
          messages: [Message.user('Answer.')],
          approval: { mode: 'trust', interactive: false },
          modeOf: builtinMode('trust'),
          context: projecting((input) => Effect.succeed({ messages: input.messages })),
        });
        yield* TestClock.adjust('1 second');
        const failure = yield* Effect.flip(handle.output.text);
        expect(failure.cause).toMatchObject({ cause: overflow, retry: { attempts: 2, retries: 1 } });
        const events: AgentEvent[] = [];
        yield* Effect.flip(
          handle.recording.stream().pipe(
            Stream.runForEach((event) =>
              Effect.sync(() => {
                events.push(event);
              }),
            ),
          ),
        );
        expect(events.filter((event) => event.type === 'text-delta')).toEqual([
          { type: 'text-delta', id: 'text-1', text: 'Partial reply.' },
        ]);
      }).pipe(Effect.provide(TestClock.layer()));
    }),
  );
  it.live(
    'forces one compaction retry before exposing provider output',
    Effect.fnUntraced(function* () {
      const model = fakeModel((callNumber) => (callNumber === 1 ? contextOverflowTurn() : textTurn('Recovered after compaction.')));
      const contextModes: boolean[] = [];
      const handle = yield* runner(model).run(agent(), {
        runId: 'run-1',
        ctx: {},
        model: {
          ownerId: 'owner-1',
          provider: 'openai-oauth',
          model: 'gpt-5.5',
          reasoning: 'high',
          switches: {},
        },
        messages: [Message.user('Keep the whole latest turn.')],
        approval: { mode: 'trust', interactive: false },
        modeOf: builtinMode('trust'),
        context: projecting((input) =>
          Effect.sync(() => {
            contextModes.push(input.contextOverflow);
            return {
              messages: input.contextOverflow ? [Message.user('Anchored state plus the latest turn.')] : input.messages,
            };
          }),
        ),
      });
      const uiChunks: unknown[] = [];
      const ui = yield* Effect.forkScoped(
        Effect.matchCause(
          Stream.runForEach(handle.recording.stream(), (chunk) =>
            Effect.sync(() => {
              uiChunks.push(chunk);
            }),
          ),
          { onFailure: Cause.squash, onSuccess: () => null },
        ),
      );
      expect(yield* handle.output.text).toBe('Recovered after compaction.');
      yield* Fiber.join(ui);
      expect(model.calls).toHaveLength(2);
      expect(contextModes).toEqual([false, true]);
      expect(handle.completedSteps()).toHaveLength(1);
      expect(yield* streamCause(handle)).toBeNull();
      expect(
        uiChunks.filter(
          (chunk) =>
            (
              chunk as {
                type?: string;
              }
            ).type === 'run-start',
        ),
      ).toHaveLength(1);
      expect(JSON.stringify(uiChunks)).toContain('Recovered after compaction.');
    }),
  );
  it.live(
    'recomputes skill tool access from the compacted retry history',
    Effect.fnUntraced(function* () {
      const skills = [
        {
          id: 'writer',
          description: 'Write an artifact.',
          instructions: () => 'Follow the writer contract.',
          tools: () => ({
            write_artifact: Tool.make({
              display: () => ({ form: 'none' }),
              approval: ASKS_NEVER,
              description: 'Write the requested artifact.',
              parameters: Schema.Struct({ content: Schema.String }),
              execute: ({ content }) => Effect.succeed({ content }),
            }),
          }),
        },
      ] satisfies AgentSkillPool<Record<string, never>, 'writer'>;
      const model = fakeModel((callNumber) => (callNumber === 1 ? contextOverflowTurn() : textTurn('Recovered with the skill locked.')));
      const skillAgent = new Agent({
        id: 'skill-agent',
        name: 'Skill agent',
        description: 'Exercises thread-scoped skill access.',
        stopWhen: [stepLimit(TEST_MAX_STEPS)],
        instructions: () => 'Load matching skills before acting.',
        tools: (ctx: Record<string, never>) => agentSkillTools(skills, ctx),
        rules: [agentSkillRule(skills)],
      });
      const handle = yield* runner(model).run(skillAgent, {
        runId: 'run-skill-overflow',
        ctx: {},
        model: {
          ownerId: 'owner-1',
          provider: 'openai-oauth',
          model: 'gpt-5.5',
          reasoning: 'high',
          switches: {},
        },
        messages: [
          {
            role: 'assistant',
            content: [
              {
                type: 'tool-call',
                id: 'load-writer',
                name: LOAD_SKILL_TOOL,
                input: { skill: 'writer' },
              },
            ],
          },
          {
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                id: 'load-writer',
                name: LOAD_SKILL_TOOL,
                result: {
                  type: 'json',
                  value: { status: 'loaded', skill: 'writer', instructions: 'Follow the writer contract.' },
                },
              },
            ],
          },
          Message.user('Write another artifact.'),
        ],
        approval: { mode: 'trust', interactive: false },
        modeOf: builtinMode('trust'),
        context: projecting((input) =>
          Effect.succeed({
            messages: input.contextOverflow ? [Message.user('Write another artifact.')] : input.messages,
          }),
        ),
      });
      expect(yield* handle.output.text).toBe('Recovered with the skill locked.');
      expect(model.calls.map(callableTools)).toEqual([[LOAD_SKILL_TOOL, 'write_artifact'], [LOAD_SKILL_TOOL]]);
    }),
  );
  it.live(
    'does not retry the recovery request again',
    Effect.fnUntraced(function* () {
      const overflow = contextOverflow();
      const model = fakeModel(() => contextOverflowTurn(overflow));
      const handle = yield* runner(model).run(agent(), {
        runId: 'run-2',
        ctx: {},
        model: {
          ownerId: 'owner-1',
          provider: 'openai-oauth',
          model: 'gpt-5.5',
          reasoning: 'high',
          switches: {},
        },
        messages: [Message.user('An oversized latest turn.')],
        approval: { mode: 'trust', interactive: false },
        modeOf: builtinMode('trust'),
        context: projecting((input) => Effect.succeed({ messages: input.messages })),
      });
      expect(yield* Effect.matchCause(handle.output.text, { onFailure: Cause.squash, onSuccess: () => null })).toMatchObject({
        cause: overflow,
      });
      expect(model.calls).toHaveLength(2);
      expect(yield* streamCause(handle)).toBe(overflow);
    }),
  );
  it.live(
    'rejects a provider error after partial output without losing the completed partial step',
    Effect.fnUntraced(function* () {
      const failure = doorFailure(new Error('Provider stream failed after partial output.'));
      const model = fakeModel(() => failedTextTurn('Partial reply.', failure));
      const handle = yield* runner(model).run(agent(), {
        runId: 'run-partial-failure',
        ctx: {},
        model: {
          ownerId: 'owner-1',
          provider: 'openai-oauth',
          model: 'gpt-5.5',
          reasoning: 'high',
          switches: {},
        },
        messages: [Message.user('Start answering, then fail.')],
        approval: { mode: 'trust', interactive: false },
        modeOf: builtinMode('trust'),
        context: projecting((input) => Effect.succeed({ messages: input.messages })),
      });
      const uiChunks: unknown[] = [];
      const ui = yield* Effect.forkScoped(
        Effect.matchCause(
          Stream.runForEach(handle.recording.stream(), (chunk) =>
            Effect.sync(() => {
              uiChunks.push(chunk);
            }),
          ),
          { onFailure: Cause.squash, onSuccess: () => null },
        ),
      );
      const uiFailure = Fiber.join(ui);
      expect(yield* Effect.matchCause(handle.output.text, { onFailure: Cause.squash, onSuccess: () => null })).toMatchObject({
        message: expect.stringContaining(failure.message),
      });
      expect(yield* uiFailure).toMatchObject({ cause: failure });
      expect(handle.completedSteps()).toHaveLength(1);
      expect(handle.completedSteps()[0]?.text).toBe('Partial reply.');
      expect(yield* streamCause(handle)).toBe(failure);
      expect(JSON.stringify(uiChunks)).toContain('Partial reply.');
    }),
  );
  it.live(
    'projects no context for a model selection the wire refused',
    Effect.fnUntraced(function* () {
      const refusal = new LLMError({
        module: 'Provider',
        method: 'stream',
        reason: new InvalidRequestReason({ message: 'That model is not available for this key.' }),
      });
      const projections: number[] = [];
      const refused: ModelRequest = {
        plannedOutputTokens: 0,
        refusal,
        text: () => {
          throw new Error('the loop never opens a one-shot');
        },
        object: () => {
          throw new Error('the loop never opens a one-shot');
        },
        stream: () => Stream.fail(refusal),
      };
      const handle = yield* runner({ request: refused, calls: [], selections: [] }).run(agent(), {
        runId: 'run-refused-model',
        ctx: {},
        model: { ownerId: 'owner-1', provider: 'openai-oauth', model: 'gpt-5.5', reasoning: 'high', switches: {} },
        messages: [Message.user('Answer with a model nobody granted.')],
        approval: { mode: 'trust', interactive: false },
        modeOf: builtinMode('trust'),
        context: projecting((input) =>
          Effect.sync(() => {
            projections.push(input.stepNumber);
            return { messages: input.messages };
          }),
        ),
      });
      expect(yield* Effect.matchCause(handle.output.text, { onFailure: Cause.squash, onSuccess: () => null })).toMatchObject({
        message: expect.stringContaining(refusal.message),
      });
      expect(projections).toEqual([]);
      expect(yield* streamCause(handle)).toBe(refusal);
    }),
  );
  const lengthRun = (model: FakeModel, runId: string, built: Agent<Record<string, never>> = agent()) =>
    runner(model).run(built, {
      runId,
      ctx: {},
      model: { ownerId: 'owner-1', provider: 'openai-oauth', model: 'gpt-5.5', reasoning: 'high', switches: {} },
      messages: [Message.user('Give a complete answer.')],
      approval: { mode: 'trust', interactive: false },
      modeOf: builtinMode('trust'),
      context: projecting((input) => Effect.succeed({ messages: input.messages })),
    });
  const continuing = (model: FakeModel): FakeModel => ({
    ...model,
    request: { ...model.request, continuation: { limit: 2, prompt: 'Resume where the output stopped.' } },
  });
  const ending = (messages: readonly Message[]) =>
    messages.slice(-2).map((message) => ({
      role: message.role,
      parts: message.content.map((part) => part.type),
      text: message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join(''),
    }));
  it.live(
    'a response the output limit cut continues from its partial text by the provider policy and completes',
    Effect.fnUntraced(function* () {
      const model = continuing(
        fakeModel((call) => (call === 1 ? finishedTextTurn('Partial reply at the token limit.', 'length') : textTurn('The rest.'))),
      );
      const handle = yield* lengthRun(model, 'run-length-continued');

      expect(yield* handle.output.text).toBe('The rest.');
      expect(yield* handle.output.finishReason).toBe('stop');
      expect(ending(model.calls[1]!.messages)).toEqual([
        { role: 'assistant', parts: ['text'], text: 'Partial reply at the token limit.' },
        { role: 'user', parts: ['text'], text: 'Resume where the output stopped.' },
      ]);
      expect(agentOriginOf(model.calls[1]!.messages.at(-1)!)).toBe('guidance');
    }),
  );
  it.live(
    'a reasoning-only response the output limit cut continues with its reasoning kept',
    Effect.fnUntraced(function* () {
      const model = continuing(
        fakeModel((call) =>
          call === 1
            ? {
                events: [
                  { type: 'step-start', index: 0 },
                  { type: 'reasoning-start', id: 'reasoning-1' },
                  { type: 'reasoning-delta', id: 'reasoning-1', text: 'Long deliberation.' },
                  { type: 'reasoning-end', id: 'reasoning-1' },
                  finished('length'),
                ],
              }
            : textTurn('Answer.'),
        ),
      );
      const handle = yield* lengthRun(model, 'run-length-reasoning');

      expect(yield* handle.output.text).toBe('Answer.');
      expect(ending(model.calls[1]!.messages)).toEqual([
        { role: 'assistant', parts: ['reasoning'], text: '' },
        { role: 'user', parts: ['text'], text: 'Resume where the output stopped.' },
      ]);
    }),
  );
  it.live(
    'a call whose input the output limit cut is answered unrun and the run goes on',
    Effect.fnUntraced(function* () {
      let executed = 0;
      const model = continuing(
        fakeModel((call) =>
          call === 1
            ? {
                events: [
                  { type: 'step-start', index: 0 },
                  { type: 'tool-input-start', id: 'call-cut', name: 'side_effect' },
                  { type: 'tool-input-delta', id: 'call-cut', name: 'side_effect', text: '{"note":"unfin' },
                  { type: 'tool-call', id: 'call-cut', name: 'side_effect', input: {}, unparsed: '{"note":"unfin' },
                  finished('length'),
                ],
              }
            : textTurn('Done.'),
        ),
      );
      const handle = yield* lengthRun(
        model,
        'run-length-tool',
        sideEffectAgent(() => {
          executed += 1;
          return 'ran';
        }),
      );

      expect(yield* handle.output.text).toBe('Done.');
      expect(executed).toBe(0);
      const answered = model.calls[1]!.messages.flatMap((message) => message.content).find((part) => part.type === 'tool-result');
      expect(answered).toMatchObject({ id: 'call-cut', result: { type: 'error' } });
    }),
  );
  it.live(
    'a cut response does not continue past the agent’s own stop condition',
    Effect.fnUntraced(function* () {
      const model = continuing(fakeModel((call) => finishedTextTurn(`Partial ${call}.`, 'length')));
      const single = new Agent({
        id: 'single-step-agent',
        name: 'Single step agent',
        description: 'Stops after one step.',
        stopWhen: [stepLimit(1)],
        instructions: () => 'Answer the user.',
        tools: () => ({}),
      });
      const handle = yield* lengthRun(model, 'run-length-bounded', single);

      expect(yield* streamCause(handle)).toMatchObject({ _tag: 'AgentResponseUnfinished', finish: 'length', continuation: undefined });
      expect(model.calls).toHaveLength(1);
    }),
  );
  it.live(
    'a run resumed after spent continuations keeps what it spent',
    Effect.fnUntraced(function* () {
      const model = continuing(fakeModel(() => finishedTextTurn('Partial again.', 'length')));
      const policy = model.request.continuation!;
      const handle = yield* runner(model).run(agent(), {
        runId: 'run-length-resumed',
        ctx: {},
        model: { ownerId: 'owner-1', provider: 'openai-oauth', model: 'gpt-5.5', reasoning: 'high', switches: {} },
        messages: [
          Message.user('Give a complete answer.'),
          Message.assistant('Partial 1.'),
          continuationMessage(policy),
          Message.assistant('Partial 2.'),
          continuationMessage(policy),
        ],
        approval: { mode: 'trust', interactive: false },
        modeOf: builtinMode('trust'),
        context: projecting((input) => Effect.succeed({ messages: input.messages })),
      });

      expect(yield* streamCause(handle)).toMatchObject({ finish: 'length', continuation: { continued: 2, limit: 2 } });
      expect(model.calls).toHaveLength(1);
    }),
  );
  it.live(
    'a response still cut once the provider policy is spent ends the run typed, keeping every partial step',
    Effect.fnUntraced(function* () {
      const model = continuing(fakeModel((call) => finishedTextTurn(`Partial ${call}.`, 'length')));
      const handle = yield* lengthRun(model, 'run-length-limited');

      const failure = yield* streamCause(handle);
      expect(failure).toBeInstanceOf(AgentResponseUnfinished);
      expect(failure).toMatchObject({ finish: 'length', continuation: { continued: 2, limit: 2 } });
      expect(model.calls).toHaveLength(3);
      expect(handle.completedSteps().map((step) => step.text)).toEqual(['Partial 1.', 'Partial 2.', 'Partial 3.']);
      expect(
        threadFailure({ id: 'run-length-limited', threadId: 'thread-1', provider: 'openai-oauth' }, failure).diagnostics,
      ).toMatchObject({ stage: 'model.finish', type: 'OutputLimit', retryable: false, modelStarted: true });
    }),
  );
  it.live(
    'rejects partial output when the provider closes without a terminal chunk',
    Effect.fnUntraced(function* () {
      const model = fakeModel(() => unfinishedTextTurn('Partial reply before silent EOF.'));
      const handle = yield* runner(model).run(agent(), {
        runId: 'run-silent-eof',
        ctx: {},
        model: {
          ownerId: 'owner-1',
          provider: 'openai-oauth',
          model: 'gpt-5.5',
          reasoning: 'high',
          switches: {},
        },
        messages: [Message.user('Give a complete answer.')],
        approval: { mode: 'trust', interactive: false },
        modeOf: builtinMode('trust'),
        context: projecting((input) => Effect.succeed({ messages: input.messages })),
      });
      expect(yield* Effect.matchCause(handle.output.text, { onFailure: Cause.squash, onSuccess: () => null })).toBeInstanceOf(Error);
      expect(yield* streamCause(handle)).toBeInstanceOf(Error);
      expect(handle.completedSteps()).toHaveLength(1);
      expect(handle.completedSteps()[0]?.text).toBe('Partial reply before silent EOF.');
    }),
  );
  it.live(
    'accepts tool-calls as a successful terminal reason when agent policy stops after the tool',
    Effect.fnUntraced(function* () {
      let executions = 0;
      const model = fakeModel(() => toolCallTurn('side_effect', 'call-1'));
      const handle = yield* runner(model).run(
        terminalToolAgent(() => {
          executions += 1;
          return 'done';
        }),
        {
          runId: 'run-terminal-tool-call',
          ctx: {},
          model: {
            ownerId: 'owner-1',
            provider: 'openai-oauth',
            model: 'gpt-5.5',
            reasoning: 'high',
            switches: {},
          },
          messages: [Message.user('Run the tool once.')],
          approval: { mode: 'trust', interactive: false },
          modeOf: builtinMode('trust'),
          context: projecting((input) => Effect.succeed({ messages: input.messages })),
        },
      );
      expect(yield* handle.output.finishReason).toBe('tool-calls');
      expect(yield* handle.output.steps).toHaveLength(1);
      expect(yield* streamCause(handle)).toBeNull();
      expect(model.calls).toHaveLength(1);
      expect(executions).toBe(1);
    }),
  );
  it.live(
    'does not retain or expose raw output when post-execution retention fails',
    Effect.fnUntraced(function* () {
      let executions = 0;
      let projections = 0;
      const contextSteps: number[] = [];
      const contextMessageRoles: string[][] = [];
      const rawOutput = 'x'.repeat(100_000);
      const resultRetention = { retainAboveCharacters: 50_000 } as const;
      const model = fakeModel(
        (callNumber) => (callNumber === 1 ? toolCallTurn('side_effect', 'call-1') : textTurn('Continued without rerunning.')),
        resultRetention,
      );
      let receivedRetention: ModelRequest['resultRetention'];
      const toolOutputs: AgentToolOutputs = {
        project: (input) =>
          Effect.suspend(() => {
            projections += 1;
            receivedRetention = input.retention;
            return Effect.fail(new AgentHostFailed({ port: 'toolOutputs', cause: new Error('retention failed') }));
          }),
        projectMessages: (messages) => Effect.succeed(messages),
      };
      const handle = yield* runner(model).run(
        sideEffectAgent(() => {
          executions += 1;
          return rawOutput;
        }),
        {
          runId: 'run-3',
          ctx: {},
          model: {
            ownerId: 'owner-1',
            provider: 'openai-oauth',
            model: 'gpt-5.5',
            reasoning: 'high',
            switches: {},
          },
          messages: [Message.user('Run the side effect once.')],
          approval: { mode: 'trust', interactive: false },
          modeOf: builtinMode('trust'),
          toolOutputs,
          context: projecting((input) =>
            Effect.sync(() => {
              contextSteps.push(input.stepNumber);
              contextMessageRoles.push(input.messages.map((message) => message.role));
              return { messages: input.messages };
            }),
          ),
        },
      );
      expect(yield* handle.output.text).toBe('Continued without rerunning.');
      expect(executions).toBe(1);
      expect(projections).toBe(1);
      expect(receivedRetention).toEqual(resultRetention);
      expect((yield* handle.output.steps)[0]?.toolResults[0]?.output).toEqual(
        expect.objectContaining({ toolCompleted: true, retained: false }),
      );
      expect(JSON.stringify(yield* handle.output.steps)).not.toContain(rawOutput);
      expect(contextSteps).toEqual([0, 1]);
      expect(contextMessageRoles[1]).toEqual(['user', 'assistant', 'tool']);
    }),
  );
});
describe('AgentRunner loop grain', () => {
  const baseInput = (runId: string) => ({
    runId,
    ctx: {},
    model: {
      ownerId: 'owner-1',
      provider: 'openai-oauth' as const,
      model: 'gpt-5.5',
      reasoning: 'high',
      switches: {},
    },
    messages: [Message.user('Serve the turn.')],
    approval: { mode: 'trust' as const, interactive: false },
    modeOf: builtinMode('trust'),
    context: projecting((input) => Effect.succeed({ messages: input.messages })),
  });
  function reportingAgent(hooks: { onReport?: () => void; onCard?: () => unknown }): Agent<Record<string, never>> {
    return new Agent({
      id: 'reporting-agent',
      name: 'Reporting agent',
      description: 'A named-force fixture: a forced report first, then free tools, then text.',
      instructions: () => 'Report first, then act.',
      tools: () => ({
        report: Tool.make({
          display: () => ({ form: 'none' }),
          approval: ASKS_NEVER,
          description: 'Record the structural report.',
          parameters: Schema.Struct({}),
          execute: () =>
            Effect.sync(() => {
              hooks.onReport?.();
              return { status: 'recorded' };
            }),
        }),
        card: Tool.make({
          display: () => ({ form: 'none' }),
          approval: ASKS_NEVER,
          description: 'Show one card.',
          parameters: Schema.Struct({}),
          execute: () => Effect.sync(() => (hooks.onCard ? hooks.onCard() : { status: 'shown' })),
        }),
      }),
      rules: [
        agentRule<Record<string, never>>(
          'report-first',
          (ctx) => {
            if (ctx.hook !== 'beforeStep') return null;
            if (ctx.run.called('report')) return null;
            return { type: 'require', tool: 'report' };
          },
          { owner: 'test' },
        ),
      ],
      stopWhen: [stepLimit(8)],
    });
  }
  it.live(
    'a message with no tool call ends the run — a card planned for a later message never runs',
    Effect.fnUntraced(function* () {
      let cardShown = 0;
      const model = fakeModel((callNumber) => {
        if (callNumber === 1) return toolCallTurn('report', 'rep-1', { summary: 'sealed' });
        if (callNumber === 2) return textTurn('Here is the card.');
        return toolCallTurn('card', 'card-1');
      });
      const handle = yield* runner(model).run(
        reportingAgent({
          onCard: () => {
            cardShown += 1;
            return { status: 'shown' };
          },
        }),
        baseInput('run-grain-phantom'),
      );
      expect(yield* handle.output.text).toBe('Here is the card.');
      expect(model.calls).toHaveLength(2);
      expect(cardShown).toBe(0);
      expect(yield* handle.output.steps).toHaveLength(2);
    }),
  );
  it.live(
    'a card called in the same message as its text executes before the turn ends',
    Effect.fnUntraced(function* () {
      let cardShown = 0;
      const model = fakeModel((callNumber) => {
        if (callNumber === 1) return toolCallTurn('report', 'rep-1', { summary: 'sealed' });
        if (callNumber === 2) return textThenToolTurn('Here is the card.', 'card', 'card-1');
        return textTurn('Done.');
      });
      const handle = yield* runner(model).run(
        reportingAgent({
          onCard: () => {
            cardShown += 1;
            return { status: 'shown' };
          },
        }),
        baseInput('run-grain-same-message'),
      );
      const steps = yield* handle.output.steps;
      expect(cardShown).toBe(1);
      expect(model.calls).toHaveLength(3);
      const partTypes = steps[1]?.content.map((part) => part.type).filter((type) => type === 'text' || type === 'tool-call');
      expect(partTypes).toEqual(['text', 'tool-call']);
      expect(handle.completedSteps()).toHaveLength(steps.length);
    }),
  );
  it.live(
    'text streamed alongside the forced report is one legal step and the planned card still runs',
    Effect.fnUntraced(function* () {
      let cardShown = 0;
      let reported = 0;
      const model = fakeModel((callNumber) => {
        if (callNumber === 1) return textThenToolTurn('The reply.', 'report', 'rep-1');
        if (callNumber === 2) return toolCallTurn('card', 'card-1');
        return textTurn('Done.');
      });
      const handle = yield* runner(model).run(
        reportingAgent({
          onReport: () => {
            reported += 1;
          },
          onCard: () => {
            cardShown += 1;
            return { status: 'shown' };
          },
        }),
        baseInput('run-grain-grok'),
      );
      const steps = yield* handle.output.steps;
      expect(reported).toBe(1);
      expect(cardShown).toBe(1);
      expect(steps).toHaveLength(3);
      const partTypes = steps[0]?.content.map((part) => part.type).filter((type) => type === 'text' || type === 'tool-call');
      expect(partTypes).toEqual(['text', 'tool-call']);
    }),
  );
  it.live(
    'a rule-required tool is forced through the call and released once called',
    Effect.fnUntraced(function* () {
      const model = fakeModel((callNumber) =>
        callNumber === 1 ? toolCallTurn('report', 'rep-1', { summary: 'sealed' }) : textTurn('Done.'),
      );
      const handle = yield* runner(model).run(reportingAgent({}), baseInput('run-grain-force'));
      yield* handle.output.text;
      expect(model.calls[0]?.toolChoice).toEqual({ type: 'tool', toolName: 'report' });
      expect(model.calls[1]?.toolChoice).toBeUndefined();
    }),
  );
  const requestedSkills = [{ id: 'writer', description: 'Write.', instructions: () => 'Writer instructions.' }] satisfies AgentSkillPool<
    Record<string, never>
  >;
  const requestingAgent = new Agent({
    id: 'requesting',
    name: 'Requesting',
    description: 'Explicit skill loading.',
    instructions: () => 'Follow reader requests.',
    tools: (ctx: Record<string, never>) => agentSkillTools(requestedSkills, ctx),
    rules: [agentSkillRequestRule(requestedSkills), agentSkillRule(requestedSkills)],
    stopWhen: [stepLimit(TEST_MAX_STEPS)],
  });
  const skillProjection = projecting((input) =>
    Effect.succeed({
      messages: input.contextOverflow
        ? projectThreadHistory(
            input.messages,
            { coveredMessageCount: input.messages.length, summary: 'Continue.' },
            'Earlier history was compacted.',
            { maxOpeningTokens: 0, imageTokens: 0 },
          )
        : input.messages,
    }),
  );
  it.live(
    'a fresh reader steer requires its skill in the same step and survives the retry once',
    Effect.fnUntraced(function* () {
      const queue: ThreadSignal[] = [
        {
          id: 'skill-steer',
          type: 'user-message',
          addressee: 'reader',
          text: 'Use $writer.',
          occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
        },
      ];
      const model = fakeModel((callNumber) =>
        callNumber === 1
          ? contextOverflowTurn()
          : callNumber === 2
            ? toolCallTurn(LOAD_SKILL_TOOL, 'load-writer', { skill: 'writer' })
            : textTurn('Done.'),
      );
      const handle = yield* runner(model).run(requestingAgent, {
        ...baseInput('run-steered-skill'),
        context: skillProjection,
        signals: { drain: () => Effect.sync(() => queue.splice(0)), hasPending: () => Effect.sync(() => queue.length > 0) },
      });
      yield* handle.output.text;
      expect(model.calls.map((call) => call.toolChoice)).toEqual([
        { type: 'tool', toolName: LOAD_SKILL_TOOL },
        { type: 'tool', toolName: LOAD_SKILL_TOOL },
        undefined,
      ]);
      expect(
        model.calls.slice(0, 2).map((call) => call.messages.filter((message) => agentInputSkills(message)?.has('writer')).length),
      ).toEqual([1, 1]);
      expect(handle.guidance.map((entry) => entry.texts.flatMap((text) => skillReferences(text).map((ref) => ref.id)))).toEqual([
        ['writer'],
      ]);
    }),
  );
  it.live(
    'compaction on retry publishes newly required skill subjects before the model is called',
    Effect.fnUntraced(function* () {
      const model = fakeModel((callNumber) =>
        callNumber === 1
          ? contextOverflowTurn()
          : callNumber === 2
            ? toolCallTurn(LOAD_SKILL_TOOL, 'reload-writer', { skill: 'writer' })
            : textTurn('Done.'),
      );
      const handle = yield* runner(model).run(requestingAgent, {
        ...baseInput('run-retry-skill-guide'),
        context: skillProjection,
        messages: [
          Message.user('Use $writer.'),
          Message.assistant([{ type: 'tool-call', name: LOAD_SKILL_TOOL, id: 'prior-load', input: { skill: 'writer' } }]),
          Message.tool({
            name: LOAD_SKILL_TOOL,
            id: 'prior-load',
            result: { status: 'loaded', skill: 'writer', instructions: 'Writer instructions.' },
          }),
        ],
      });
      yield* handle.output.text;
      expect(model.calls.map((call) => call.toolChoice)).toEqual([undefined, { type: 'tool', toolName: LOAD_SKILL_TOOL }, undefined]);
      const guides = model.calls[1]!.messages.filter((message) => agentOriginOf(message) === 'guidance');
      expect(
        guides.flatMap((message) =>
          message.content.flatMap((part) => (part.type === 'text' ? skillReferences(part.text).map((ref) => ref.id) : [])),
        ),
      ).toEqual(['writer']);
    }),
  );
  it.live(
    'signals drain at step boundaries and enter the next step as user messages',
    Effect.fnUntraced(function* () {
      const drainedAt: number[] = [];
      const model = fakeModel((callNumber) =>
        callNumber === 1 ? toolCallTurn('report', 'rep-1', { summary: 'sealed' }) : textTurn('Reacting.'),
      );
      const handle = yield* runner(model).run(reportingAgent({}), {
        ...baseInput('run-grain-signals'),
        signals: {
          drain: Effect.fnUntraced(function* (stepNumber: number) {
            drainedAt.push(stepNumber);
            return stepNumber === 1
              ? [
                  {
                    id: 's1',
                    type: 'widget-answer',
                    text: 'SIGNAL-MARKER-42',
                    occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
                  },
                ]
              : [];
          }),
          hasPending: () => Effect.succeed(false),
        },
      });
      expect(yield* handle.output.text).toBe('Reacting.');
      expect(drainedAt).toEqual([0, 1]);
      expect(JSON.stringify(model.calls[1]?.messages)).toContain('SIGNAL-MARKER-42');
    }),
  );
  it.live(
    'a drained steer carrying media reaches the model as one user message with a text and a media part',
    Effect.fnUntraced(function* () {
      const model = fakeModel((callNumber) =>
        callNumber === 1 ? toolCallTurn('report', 'rep-media', { summary: 'sealed' }) : textTurn('Seen it.'),
      );
      let waiting = true;
      const handle = yield* runner(model).run(reportingAgent({}), {
        ...baseInput('run-grain-steer-media'),
        signals: {
          drain: Effect.fnUntraced(function* (stepNumber: number) {
            if (stepNumber !== 1 || !waiting) return [];
            waiting = false;
            return [
              {
                id: 's1',
                type: 'user-message',
                addressee: 'reader' as const,
                text: 'STEER-MARKER-MEDIA',
                attached: [{ type: 'media' as const, mediaType: 'image/png', data: 'test://shot-9' }],
                occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
              },
            ];
          }),
          hasPending: () => Effect.sync(() => waiting),
        },
      });
      expect(yield* handle.output.text).toBe('Seen it.');
      const carried = model.calls[1]?.messages.findLast(
        (message) =>
          message.role === 'user' && message.content.some((part) => part.type === 'text' && part.text.includes('STEER-MARKER-MEDIA')),
      );
      expect(carried?.content.map((part) => part.type)).toEqual(['text', 'media']);
      expect(carried?.content.find((part) => part.type === 'media')).toMatchObject({
        mediaType: 'image/png',
        data: 'test://shot-9',
      });
    }),
  );
  it.live(
    'words that arrive while the final answer streams are read by the same run before it ends',
    Effect.fnUntraced(function* () {
      let waiting = false;
      const model = fakeModel((callNumber) => {
        if (callNumber === 1) waiting = true;
        return textTurn(callNumber === 1 ? 'First answer.' : 'Read you.');
      });
      const handle = yield* runner(model).run(agent(), {
        ...baseInput('run-grain-steer-final-step'),
        signals: {
          drain: Effect.fnUntraced(function* () {
            if (!waiting) return [];
            waiting = false;
            return [
              {
                id: 's1',
                type: 'user-message',
                addressee: 'reader' as const,
                text: 'STEER-MARKER-7',
                occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
              },
            ];
          }),
          hasPending: () => Effect.sync(() => waiting),
        },
      });
      expect(yield* handle.output.text).toBe('Read you.');
      expect(model.calls).toHaveLength(2);
      expect(JSON.stringify(model.calls[1]?.messages)).toContain('STEER-MARKER-7');
      expect(waiting).toBe(false);
    }),
  );
  for (const arrived of [
    { id: 'w1', type: 'user-message', addressee: 'reader', text: 'STEER-MARKER-WAY' },
    { id: 'r1', type: 'report', addressee: 'transport', text: 'REPORT-MARKER-WAY', from: 'reviewer', senderThreadId: 'child' },
  ] as const)
    it.live(
      `${arrived.type} ends a call that only watches, and the next step reads it beside its wait-ended answer`,
      Effect.fnUntraced(function* () {
        const entered = Deferred.makeUnsafe<void>();
        const watching = new Agent({
          id: 'watching-agent',
          name: 'Watching agent',
          description: 'Waits on work that runs without it.',
          instructions: () => 'Wait for the work.',
          tools: () => ({
            watch: Tool.make({
              display: () => ({ form: 'none' }),
              approval: ASKS_NEVER,
              description: 'Wait for outside work.',
              parameters: Schema.Struct({}),
              execute: (_input, call) =>
                Effect.sync(() => call.progress?.watch()).pipe(
                  Effect.andThen(Deferred.succeed(entered, undefined)),
                  Effect.andThen(Effect.never),
                ),
            }),
          }),
          stopWhen: [stepLimit(TEST_MAX_STEPS)],
        });
        const queue: ThreadSignal[] = [];
        const listeners = new Set<(signal: ThreadSignal) => void>();
        const model = fakeModel((callNumber) => (callNumber === 1 ? toolCallTurn('watch', 'watch-1') : textTurn('Read you.')));
        const handle = yield* runner(model).run(watching, {
          ...baseInput(`run-${arrived.id}-makes-way`),
          signals: {
            drain: () => Effect.sync(() => queue.splice(0)),
            hasPending: () => Effect.sync(() => queue.length > 0),
            arrivals: {
              subscribe: (listener) => {
                listeners.add(listener);
                return () => listeners.delete(listener);
              },
              unread: () => queue,
            },
          },
        });
        yield* Deferred.await(entered);
        const signal: ThreadSignal = { ...arrived, occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString() };
        queue.push(signal);
        for (const listener of listeners) listener(signal);
        expect(yield* handle.output.text).toBe('Read you.');
        const next = JSON.stringify(model.calls[1]?.messages);
        expect(next).toContain(arrived.text);
        expect(next).toContain('wait-ended');
      }),
    );
  it.live(
    'accepted input holds the next model request at its effectful input boundary',
    Effect.fnUntraced(function* () {
      const words: ThreadSignal = {
        id: 's1',
        type: 'user-message',
        addressee: 'reader',
        text: 'STEER-MARKER-11',
        occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
      };
      const reading = Deferred.makeUnsafe<void>();
      const committed = Deferred.makeUnsafe<void>();
      let accepted = false;
      let taken = false;
      const signals = {
        hasPending: () => Effect.sync(() => accepted && !taken),
        drain: Effect.fnUntraced(function* () {
          if (!accepted || taken) return [];
          yield* Deferred.succeed(reading, undefined);
          yield* Deferred.await(committed);
          taken = true;
          return [words];
        }),
      };
      const model = fakeModel((callNumber) => {
        if (callNumber === 1) {
          accepted = true;
          return toolCallTurn('report', 'rep-input', { summary: 'sealed' });
        }
        return textTurn('Read you.');
      });
      const handle = yield* runner(model).run(reportingAgent({}), {
        ...baseInput('run-grain-steer-accepted'),
        signals,
      });
      yield* Deferred.await(reading);
      expect(model.calls).toHaveLength(1);
      yield* Deferred.succeed(committed, undefined);
      expect(yield* handle.output.text).toBe('Read you.');
      expect(model.calls).toHaveLength(2);
      expect(JSON.stringify(model.calls[1]?.messages)).toContain('STEER-MARKER-11');
      expect(yield* signals.hasPending()).toBe(false);
    }),
  );
  it.live.each(['success', 'failure', 'defect'] as const)(
    'a tool %s carries its measured duration into the next model call and saved history',
    Effect.fnUntraced(function* (ending) {
      const model = fakeModel((callNumber) => (callNumber === 1 ? toolCallTurn('timed', 'timed-1') : textTurn('Settled.')));
      const timed = new Agent({
        id: 'timed-tool-agent',
        name: 'Timed tool',
        description: 'Preserves execution measurements.',
        stopWhen: [stepLimit(TEST_MAX_STEPS)],
        instructions: () => 'Call the tool.',
        tools: () => ({
          timed: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_NEVER,
            description: 'Answer after a measured interval.',
            parameters: Schema.Struct({}),
            execute: () =>
              Effect.sleep('17 millis').pipe(
                Effect.andThen(
                  ending === 'success'
                    ? Effect.succeed('answer')
                    : ending === 'failure'
                      ? Effect.fail(new ToolFailed({ reason: 'timed failure' }))
                      : Effect.die(new Error('timed defect')),
                ),
              ),
          }),
        }),
      });
      const native = yield* makeAgentRunner({ models: { request: () => model.request }, idleMs: TEST_IDLE_MS });
      yield* Effect.gen(function* () {
        const handle = yield* recordRun(native, timed, baseInput(`run-duration-${ending}`));
        yield* TestClock.adjust('17 millis');
        expect(yield* handle.output.text).toBe('Settled.');
        const steps = yield* handle.output.steps;
        const sent = model.calls[1]!.messages;
        const saved = yield* Schema.decodeUnknownEffect(Schema.Array(Message))(JSON.parse(JSON.stringify(sent)));
        for (const parts of [steps[0]!.content, saved.filter((message) => message.role === 'tool').flatMap((message) => message.content)]) {
          const result = parts.find((part) => part.type === 'tool-result');
          expect(result).toMatchObject({ id: 'timed-1', durationMs: 17 });
          if (ending !== 'success') expect(result).toMatchObject({ result: { type: 'error' } });
        }
      }).pipe(Effect.provide(TestClock.layer()));
    }),
  );
  it.live(
    'a throwing tool records a tool-error and the loop continues to a repair step',
    Effect.fnUntraced(function* () {
      const model = fakeModel((callNumber) => (callNumber === 1 ? toolCallTurn('reject_me', 'rej-1') : textTurn('Recovered.')));
      const failingAgent = new Agent({
        id: 'failing-tool-agent',
        name: 'Failing tool agent',
        description: 'Exercises tool-error continuation.',
        stopWhen: [stepLimit(TEST_MAX_STEPS)],
        instructions: () => 'Call the tool.',
        tools: () => ({
          reject_me: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_NEVER,
            description: 'Always rejects.',
            parameters: Schema.Struct({}),
            execute: () => Effect.fail(new ToolFailed({ reason: 'rejected before showing' })),
          }),
        }),
      });
      const handle = yield* runner(model).run(failingAgent, baseInput('run-grain-tool-error'));
      const seen: AgentEvent[] = [];
      yield* Stream.runForEach(handle.recording.stream(), (event) =>
        Effect.sync(() => {
          seen.push(event);
        }),
      );
      expect(yield* handle.output.text).toBe('Recovered.');
      const steps = yield* handle.output.steps;
      expect(steps).toHaveLength(2);
      expect(steps[0]?.content.some((part) => part.type === 'tool-result')).toBe(true);
      expect(seen.filter((event) => event.type === 'tool-outcome')).toEqual([
        { type: 'tool-outcome', toolCallId: 'rej-1', toolName: 'reject_me', outcome: { kind: 'failed', error: 'rejected before showing' } },
      ]);
    }),
  );
  it.live(
    'a tool body that dies fails that call alone and the run takes its next step',
    Effect.fnUntraced(function* () {
      const model = fakeModel((callNumber) => (callNumber === 1 ? toolCallTurn('project_me', 'proj-1') : textTurn('Recovered.')));
      const dyingAgent = new Agent({
        id: 'dying-tool-agent',
        name: 'Dying tool agent',
        description: 'Exercises defect containment at the execution door.',
        stopWhen: [stepLimit(TEST_MAX_STEPS)],
        instructions: () => 'Call the tool.',
        tools: () => ({
          project_me: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_NEVER,
            description: 'Answers a value its own projection cannot read.',
            parameters: Schema.Struct({}),
            execute: () =>
              Effect.map(Effect.succeed<unknown>('a string, not one of the arms'), (value) =>
                'threads' in (value as Record<string, unknown>) ? { listed: true } : { listed: false },
              ),
          }),
        }),
      });
      const handle = yield* runner(model).run(dyingAgent, baseInput('run-grain-tool-defect'));
      const seen: AgentEvent[] = [];
      yield* Stream.runForEach(handle.recording.stream(), (event) =>
        Effect.sync(() => {
          seen.push(event);
        }),
      );
      expect(yield* handle.output.text).toBe('Recovered.');
      const steps = yield* handle.output.steps;
      expect(steps).toHaveLength(2);
      const errors = seen.filter((event) => event.type === 'tool-outcome' && event.outcome.kind === 'failed');
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ toolCallId: 'proj-1', toolName: 'project_me' });
      expect(JSON.stringify(model.calls[1]?.messages)).toContain('not an Object');
    }),
  );
  it.live(
    'a running-call preview that breaks on the arguments streamed so far leaves the call untitled, and the call and the run go on',
    Effect.fnUntraced(function* () {
      const recording = activityRecording();
      const handed: string[] = [];
      const model = fakeModel((callNumber) =>
        callNumber === 1
          ? {
              events: [
                { type: 'step-start', index: 0 },
                { type: 'tool-input-start', id: 'call-hand', name: 'hand_over' },
                { type: 'tool-input-delta', id: 'call-hand', name: 'hand_over', text: '{"to":"critic",' },
                { type: 'tool-input-delta', id: 'call-hand', name: 'hand_over', text: '"task":"Read it."}' },
                { type: 'tool-call', id: 'call-hand', name: 'hand_over', input: { to: 'critic', task: 'Read it.' } },
                { type: 'step-finish', index: 0, reason: 'tool-calls' },
                finished('tool-calls'),
              ],
            }
          : textTurn('Done.'),
      );
      const handing = new Agent<Record<string, never>>({
        id: 'handing-agent',
        name: 'Handing agent',
        description: 'Hands work over through a preview that needs its whole input.',
        stopWhen: [stepLimit(TEST_MAX_STEPS)],
        instructions: () => 'Hand it over.',
        tools: () => ({
          hand_over: Tool.make({
            approval: ASKS_NEVER,
            description: 'Hands work over.',
            parameters: Schema.Struct({ to: Schema.String, task: Schema.String }),
            display: (input) => ({ form: 'message', title: input.to, text: (input.task as string).toUpperCase() }),
            execute: (input) =>
              Effect.sync(() => {
                handed.push(input.task);
                return 'handed';
              }),
          }),
        }),
      });
      const handle = yield* runner(model, recording.log).run(handing, baseInput('run-broken-preview'));
      expect(yield* handle.output.text).toBe('Done.');
      expect(handed).toEqual(['Read it.']);
      const degradations = recording.activities().flatMap((entry) => entry.notes.filter((note) => note.type === 'degraded'));
      expect(degradations).toMatchObject([{ place: 'tool preview' }]);
    }),
  );
  it.live(
    'a subjects projection that dies before the body fails its own call, and the block settles around it',
    Effect.fnUntraced(function* () {
      const ran: string[] = [];
      const model = fakeModel((callNumber) =>
        callNumber === 1
          ? parallelToolCallTurn([
              { name: 'read_first', id: 'call-1', input: { subject: 'a page of threads' } },
              { name: 'show_me', id: 'call-2', input: { subject: 'a page of threads' } },
              { name: 'read_second', id: 'call-3', input: { subject: 'a page of threads' } },
            ])
          : textTurn('Recovered.'),
      );
      const reading = (name: string) =>
        Tool.make({
          display: () => ({ form: 'none' }),
          approval: ASKS_NEVER,
          description: 'Answers a line.',
          parameters: Schema.Struct({ subject: Schema.String }),
          execute: () =>
            Effect.sync(() => {
              ran.push(name);
              return { read: name };
            }),
        });
      const projectingAgent = new Agent({
        id: 'projecting-tool-agent',
        name: 'Projecting tool agent',
        description: 'Exercises defect containment across a whole settlement.',
        stopWhen: [stepLimit(TEST_MAX_STEPS)],
        instructions: () => 'Call the tools.',
        tools: () => ({
          read_first: reading('read_first'),
          read_second: reading('read_second'),
          show_me: Tool.make({
            approval: ASKS_NEVER,
            description: 'Derives its permission subjects from an arm its input is not.',
            parameters: Schema.Struct({ subject: Schema.String }),
            display: () => ({ form: 'none' }),
            subjects: (input) => ('threads' in (input.subject as unknown as Record<string, unknown>) ? [] : []),
            execute: () =>
              Effect.sync(() => {
                ran.push('show_me');
                return { read: 'show_me' };
              }),
          }),
        }),
      });
      const handle = yield* runner(model).run(projectingAgent, baseInput('run-grain-projection-defect'));
      const seen: AgentEvent[] = [];
      yield* Stream.runForEach(handle.recording.stream(), (event) =>
        Effect.sync(() => {
          seen.push(event);
        }),
      );
      expect(yield* handle.output.text).toBe('Recovered.');
      expect(yield* handle.output.steps).toHaveLength(2);
      expect([...ran].sort()).toEqual(['read_first', 'read_second']);
      const outcomes = seen.flatMap((event) => (event.type === 'tool-outcome' ? [event] : []));
      expect(outcomes.filter((event) => event.outcome.kind === 'failed').map((event) => event.toolCallId)).toEqual(['call-2']);
      expect(
        outcomes
          .filter((event) => event.outcome.kind === 'answered')
          .map((event) => event.toolCallId)
          .sort(),
      ).toEqual(['call-1', 'call-3']);
      const next = JSON.stringify(model.calls[1]?.messages);
      expect(next).toContain('Tool show_me subjects projection failed');
      expect(next).toContain('not an Object');
      expect(next).toContain('read_first');
      expect(next).toContain('read_second');
    }),
  );
  function sealingAgent(hooks: {
    onReport?: () => void;
    onCard?: () => unknown;
    onSubject?: (summary: string) => void;
  }): Agent<Record<string, never>> {
    return new Agent({
      id: 'sealing-agent',
      name: 'Sealing agent',
      description: 'Mirrors the tutor grain: every step must call a tool; the report seals the run.',
      instructions: () => 'Work first, then seal with the report.',
      tools: () => ({
        report: Tool.make({
          display: () => ({ form: 'none' }),
          approval: ASKS_IN_REVIEW,
          description: 'Seal the turn.',
          parameters: Schema.Struct({ summary: Schema.String }),
          subjects: ({ summary }) => {
            hooks.onSubject?.(summary);
            return [{ kind: 'write' as const, value: `report:${summary}` }];
          },
          execute: () =>
            Effect.sync(() => {
              hooks.onReport?.();
              return { status: 'recorded' };
            }),
        }),
        card: Tool.make({
          display: () => ({ form: 'none' }),
          approval: ASKS_NEVER,
          description: 'Show one card.',
          parameters: Schema.Struct({}),
          execute: () => Effect.sync(() => (hooks.onCard ? hooks.onCard() : { status: 'shown' })),
        }),
      }),
      rules: [
        agentRule<Record<string, never>>(
          'seal',
          (ctx) => {
            const seal = ctx.run.ruleState('seal', () => ({ recorded: false }));
            if (ctx.hook === 'afterTool' && ctx.tool?.name === 'report') seal.recorded = true;
            if (ctx.hook !== 'beforeStep' || seal.recorded) return null;
            return { type: 'require' };
          },
          { owner: 'test' },
        ),
      ],
      stopWhen: [
        ({ steps }) => steps[steps.length - 1]?.toolResults?.some((result) => result.toolName === 'report') ?? false,
        stepLimit(8),
      ],
    });
  }
  it.live(
    'a tool-less require reaches the call as a required choice on every unsealed step',
    Effect.fnUntraced(function* () {
      const model = fakeModel((callNumber) =>
        callNumber === 1
          ? textThenToolTurn('Here is the card.', 'card', 'card-1')
          : textThenToolTurn('Final reply.', 'report', 'rep-1', { summary: 'sealed' }),
      );
      const handle = yield* runner(model).run(sealingAgent({}), baseInput('run-seal-required'));
      const steps = yield* handle.output.steps;
      expect(steps).toHaveLength(2);
      expect(model.calls.map((call) => call.toolChoice)).toEqual(['required', 'required']);
    }),
  );
  it.live(
    'the recorded seal ends the run in its own step — nothing after the seal runs',
    Effect.fnUntraced(function* () {
      let cardShown = 0;
      let reported = 0;
      const model = fakeModel((callNumber) => {
        if (callNumber === 1) return toolCallTurn('card', 'card-1');
        if (callNumber === 2) return textThenToolTurn('Final reply.', 'report', 'rep-1', { summary: 'sealed' });
        return toolCallTurn('card', 'card-2');
      });
      const handle = yield* runner(model).run(
        sealingAgent({
          onReport: () => {
            reported += 1;
          },
          onCard: () => {
            cardShown += 1;
            return { status: 'shown' };
          },
        }),
        baseInput('run-seal-stop'),
      );
      const steps = yield* handle.output.steps;
      expect(model.calls).toHaveLength(2);
      expect(steps).toHaveLength(2);
      expect(reported).toBe(1);
      expect(cardShown).toBe(1);
      const partTypes = steps[1]?.content.map((part) => part.type).filter((type) => type === 'text' || type === 'tool-call');
      expect(partTypes).toEqual(['text', 'tool-call']);
    }),
  );
  it.live(
    'a schema-invalid seal is refused before its subject projection, and the run retries',
    Effect.fnUntraced(function* () {
      let reported = 0;
      const subjects: string[] = [];
      const model = fakeModel((callNumber) =>
        callNumber === 1
          ? invalidToolCallTurn('report', 'rep-bad', { bogus: true })
          : toolCallTurn('report', 'rep-good', { summary: 'sealed' }),
      );
      const handle = yield* runner(model).run(
        sealingAgent({
          onReport: () => {
            reported += 1;
          },
          onSubject: (summary) => subjects.push(summary),
        }),
        baseInput('run-seal-retry'),
      );
      const steps = yield* handle.output.steps;
      expect(steps).toHaveLength(2);
      expect(reported).toBe(1);
      expect(subjects).toEqual(['sealed']);
      expect(JSON.stringify(model.calls[1]?.messages)).toContain('report tool was called with invalid arguments');
      expect(model.calls.map((call) => call.toolChoice)).toEqual(['required', 'required']);
    }),
  );
  it.live(
    'stopWhen caps a tool-looping model',
    Effect.fnUntraced(function* () {
      const cappedAgent = new Agent({
        id: 'capped-agent',
        name: 'Capped agent',
        description: 'Exercises the step cap.',
        instructions: () => 'Loop.',
        tools: () => ({
          spin: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_NEVER,
            description: 'Spin once.',
            parameters: Schema.Struct({}),
            execute: () => Effect.succeed({ ok: true }),
          }),
        }),
        stopWhen: [stepLimit(3)],
      });
      const model = fakeModel((callNumber) => toolCallTurn('spin', `spin-${callNumber}`));
      const handle = yield* runner(model).run(cappedAgent, baseInput('run-grain-cap'));
      expect(yield* handle.output.steps).toHaveLength(3);
      expect(model.calls).toHaveLength(3);
    }),
  );
});
describe('the turn loop owns its iteration', () => {
  const input = (runId: string) => ({
    runId,
    ctx: {},
    model: {
      ownerId: 'owner-1',
      provider: 'openai-oauth' as const,
      model: 'gpt-5.5',
      reasoning: 'high',
      switches: {},
    },
    messages: [Message.user('Serve the turn.')],
    approval: { mode: 'trust' as const, interactive: false },
    modeOf: builtinMode('trust'),
  });
  it.live(
    'same-batch read, edit and file-backed apply wait for an earlier write to their path',
    Effect.fnUntraced(function* () {
      const writing = new Set<string>();
      const order: string[] = [];
      const model = fakeModel((callNumber) =>
        callNumber === 1
          ? parallelToolCallTurn([
              { name: 'write', id: 'write-read', input: { filePath: 'notes/read.md' } },
              { name: 'read', id: 'read', input: { filePath: 'notes/read.md' } },
              { name: 'write', id: 'write-edit', input: { filePath: 'notes/edit.md' } },
              { name: 'edit', id: 'edit', input: { filePath: 'notes/edit.md' } },
              { name: 'write', id: 'write-batch', input: { filePath: 'notes/batch.json' } },
              { name: 'apply_batch', id: 'batch', input: { file: 'notes/batch.json' } },
            ])
          : textTurn('Done.'),
      );
      const scheduled = new Agent<Record<string, never>>({
        id: 'path-scheduled-agent',
        name: 'Path scheduled agent',
        description: 'Exercises same-batch path dependencies.',
        stopWhen: [stepLimit(TEST_MAX_STEPS)],
        instructions: () => 'Run every call.',
        tools: () => ({
          write: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_IN_REVIEW,
            description: 'Write one file.',
            parameters: Schema.Struct({ filePath: Schema.String }),
            claims: ({ filePath }) => Effect.succeed([{ on: { kind: 'file' as const, path: filePath }, access: 'write' as const }]),
            execute: Effect.fnUntraced(function* ({ filePath }) {
              order.push(`write:start:${filePath}`);
              writing.add(filePath);
              yield* Effect.yieldNow;
              writing.delete(filePath);
              order.push(`write:end:${filePath}`);
              return { written: filePath };
            }),
          }),
          read: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_NEVER,
            description: 'Read one file.',
            parameters: Schema.Struct({ filePath: Schema.String }),
            claims: ({ filePath }) => Effect.succeed([{ on: { kind: 'file' as const, path: filePath }, access: 'read' as const }]),
            execute: ({ filePath }) =>
              Effect.sync(() => {
                order.push(`read:${filePath}`);
                return { raced: writing.has(filePath) };
              }),
          }),
          edit: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_IN_REVIEW,
            description: 'Edit one file.',
            parameters: Schema.Struct({ filePath: Schema.String }),
            claims: ({ filePath }) => Effect.succeed([{ on: { kind: 'file' as const, path: filePath }, access: 'write' as const }]),
            execute: ({ filePath }) =>
              Effect.sync(() => {
                order.push(`edit:${filePath}`);
                return { raced: writing.has(filePath) };
              }),
          }),
          apply_batch: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_NEVER,
            description: 'Apply a document read from a file.',
            parameters: Schema.Struct({ file: Schema.String }),
            claims: ({ file }) => Effect.succeed([{ on: { kind: 'file' as const, path: file }, access: 'read' as const }]),
            execute: ({ file }) =>
              Effect.sync(() => {
                order.push(`apply_batch:${file}`);
                return { raced: writing.has(file) };
              }),
          }),
        }),
      });
      const handle = yield* runner(model).run(scheduled, input('run-path-scheduled'));
      expect(yield* handle.output.text).toBe('Done.');
      for (const [path, later] of [
        ['notes/read.md', 'read'],
        ['notes/edit.md', 'edit'],
        ['notes/batch.json', 'apply_batch'],
      ] as const) {
        expect(order.indexOf(`write:end:${path}`)).toBeLessThan(order.indexOf(`${later}:${path}`));
      }
      expect((yield* handle.output.steps)[0]?.toolResults.map((result) => result.output)).toEqual([
        { written: 'notes/read.md' },
        { raced: false },
        { written: 'notes/edit.md' },
        { raced: false },
        { written: 'notes/batch.json' },
        { raced: false },
      ]);
    }),
  );
  it.live(
    'a read beside a write awaiting the reader names the same-batch dependency',
    Effect.fnUntraced(function* () {
      let writes = 0;
      let reads = 0;
      const path = 'notes/waiting.md';
      const model = fakeModel(() =>
        parallelToolCallTurn([
          { name: 'write', id: 'write-awaiting', input: { filePath: path } },
          { name: 'read', id: 'read-blocked', input: { filePath: path } },
        ]),
      );
      const awaiting = new Agent<Record<string, never>>({
        id: 'path-awaiting-agent',
        name: 'Path awaiting agent',
        description: 'Exercises a dependency on a write awaiting confirmation.',
        stopWhen: [stepLimit(TEST_MAX_STEPS)],
        instructions: () => 'Run every call.',
        tools: () => ({
          write: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_IN_REVIEW,
            description: 'Write one file.',
            parameters: Schema.Struct({ filePath: Schema.String }),
            claims: ({ filePath }) => Effect.succeed([{ on: { kind: 'file' as const, path: filePath }, access: 'write' as const }]),
            execute: () =>
              Effect.sync(() => {
                writes += 1;
                return { written: true };
              }),
            mutates: true,
            confirmation: { prompt: () => ({ summary: 'Write it?' }), confirmLabel: 'Write' },
          }),
          read: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_NEVER,
            description: 'Read one file.',
            parameters: Schema.Struct({ filePath: Schema.String }),
            claims: ({ filePath }) => Effect.succeed([{ on: { kind: 'file' as const, path: filePath }, access: 'read' as const }]),
            execute: () =>
              Effect.sync(() => {
                reads += 1;
                return { read: true };
              }),
          }),
        }),
      });
      const native = yield* makeAgentRunner({ models: { request: () => model.request }, idleMs: TEST_IDLE_MS });
      const handle = yield* recordRun(native, awaiting, {
        ...input('run-path-awaiting'),
        approval: { mode: 'review', interactive: true },
        modeOf: builtinMode('review'),
      });
      const [step] = yield* handle.output.steps;
      const message =
        "Same-batch dependency: write (write-awaiting) must settle first — it touches notes/waiting.md, and it waits for the reader's answer. Call read in the next step.";
      expect(writes).toBe(0);
      expect(reads).toBe(0);
      expect(step?.response?.messages?.at(-1)?.content).toContainEqual({
        type: 'tool-result',
        id: 'read-blocked',
        name: 'read',
        result: { type: 'error', value: message },
      });
      expect(native.calls.get({ runId: 'run-path-awaiting', toolCallId: 'read-blocked' })?.record).toMatchObject({
        phase: 'failed',
        endedAt: expect.any(Number),
      });
      expect(native.calls.get({ runId: 'run-path-awaiting', toolCallId: 'write-awaiting' })?.record).toMatchObject({
        phase: 'waiting',
        endedAt: null,
      });
    }),
  );
  it.live(
    'a write and an unrelated search in the same batch still overlap',
    Effect.fnUntraced(function* () {
      const order: string[] = [];
      const model = fakeModel((callNumber) =>
        callNumber === 1
          ? parallelToolCallTurn([
              { name: 'write', id: 'write', input: { filePath: 'notes/today.md' } },
              { name: 'search', id: 'search', input: { path: 'src' } },
            ])
          : textTurn('Done.'),
      );
      const concurrent = new Agent<Record<string, never>>({
        id: 'path-concurrent-agent',
        name: 'Path concurrent agent',
        description: 'Exercises unrelated same-batch paths.',
        stopWhen: [stepLimit(TEST_MAX_STEPS)],
        instructions: () => 'Run every call.',
        tools: () => ({
          write: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_IN_REVIEW,
            description: 'Write one file.',
            parameters: Schema.Struct({ filePath: Schema.String }),
            claims: ({ filePath }) => Effect.succeed([{ on: { kind: 'file' as const, path: filePath }, access: 'write' as const }]),
            execute: Effect.fnUntraced(function* () {
              order.push('write:start');
              yield* Effect.yieldNow;
              order.push('write:end');
              return { written: true };
            }),
          }),
          search: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_NEVER,
            description: 'Search one path.',
            parameters: Schema.Struct({ path: Schema.String }),
            claims: ({ path }) => Effect.succeed([{ on: { kind: 'file' as const, path }, access: 'read' as const }]),
            execute: () =>
              Effect.sync(() => {
                order.push('search');
                return { found: true };
              }),
          }),
        }),
      });
      const handle = yield* runner(model).run(concurrent, input('run-path-concurrent'));
      expect(yield* handle.output.text).toBe('Done.');
      expect(order).toEqual(['write:start', 'search', 'write:end']);
    }),
  );
  it.live(
    'calls sharing a write subject that names no file run concurrently',
    Effect.fnUntraced(function* () {
      let active = 0;
      let widest = 0;
      const model = fakeModel((callNumber) =>
        callNumber === 1
          ? parallelToolCallTurn([
              { name: 'end', id: 'end-a', input: { thread: 'a' } },
              { name: 'end', id: 'end-b', input: { thread: 'b' } },
            ])
          : textTurn('Done.'),
      );
      const ending = new Agent<Record<string, never>>({
        id: 'shared-subject-agent',
        name: 'Shared subject agent',
        description: 'Exercises calls that share a permission-only subject.',
        stopWhen: [stepLimit(TEST_MAX_STEPS)],
        instructions: () => 'Run every call.',
        tools: () => ({
          end: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_IN_REVIEW,
            description: 'End one thread.',
            parameters: Schema.Struct({ thread: Schema.String }),
            subjects: () => [{ kind: 'write' as const, value: 'thread://lineage/beyond' }],
            execute: Effect.fnUntraced(function* () {
              active += 1;
              widest = Math.max(widest, active);
              yield* Effect.yieldNow;
              active -= 1;
              return { ended: true };
            }),
          }),
        }),
      });
      const handle = yield* runner(model).run(ending, input('run-shared-subject'));
      expect(yield* handle.output.text).toBe('Done.');
      expect(widest).toBe(2);
    }),
  );
  it.live(
    'a same-batch fan-out with no write remains concurrent',
    Effect.fnUntraced(function* () {
      let active = 0;
      let widest = 0;
      const model = fakeModel((callNumber) =>
        callNumber === 1
          ? parallelToolCallTurn([
              { name: 'read', id: 'read-a', input: { path: 'a' } },
              { name: 'read', id: 'read-b', input: { path: 'b' } },
              { name: 'read', id: 'read-c', input: { path: 'c' } },
            ])
          : textTurn('Done.'),
      );
      const reads = new Agent<Record<string, never>>({
        id: 'parallel-read-agent',
        name: 'Parallel read agent',
        description: 'Exercises a read-only same-batch fan-out.',
        stopWhen: [stepLimit(TEST_MAX_STEPS)],
        instructions: () => 'Run every call.',
        tools: () => ({
          read: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_NEVER,
            description: 'Read one path.',
            parameters: Schema.Struct({ path: Schema.String }),
            claims: ({ path }) => Effect.succeed([{ on: { kind: 'file' as const, path }, access: 'read' as const }]),
            execute: Effect.fnUntraced(function* () {
              active += 1;
              widest = Math.max(widest, active);
              yield* Effect.yieldNow;
              active -= 1;
              return { read: true };
            }),
          }),
        }),
      });
      const handle = yield* runner(model).run(reads, input('run-read-concurrent'));
      expect(yield* handle.output.text).toBe('Done.');
      expect(widest).toBe(3);
    }),
  );
  it.live(
    'a call the rules want a reader for is left unresolved and the run parks',
    Effect.fnUntraced(function* () {
      let runs = 0;
      const model = fakeModel(() => toolCallTurn('side_effect', 'call-1'));
      const handle = yield* runner(model).run(
        mutatingAgent(() => {
          runs += 1;
          return 'done';
        }),
        { ...input('run-parks-on-ask'), approval: { mode: 'review' as const, interactive: true }, modeOf: builtinMode('review') },
      );
      const steps = yield* handle.output.steps;
      expect(runs).toBe(0);
      expect(model.calls).toHaveLength(1);
      expect(steps.at(-1)?.toolCalls.map((call) => call.toolCallId)).toEqual(['call-1']);
      expect(steps.at(-1)?.toolResults).toEqual([]);
    }),
  );
  it.live(
    'a call naming a tool no catalog holds is answered instead of dropped, naming the catalog spelling',
    Effect.fnUntraced(function* () {
      const model = fakeModel((callNumber) =>
        callNumber === 1
          ? toolCallTurn('mcp__tagma__side_effect', 'call-1')
          : callNumber === 2
            ? toolCallTurn('nowhere', 'call-2')
            : textTurn('Called the right one.'),
      );
      const handle = yield* runner(model).run(
        sideEffectAgent(() => 'done'),
        input('run-unknown-tool'),
      );
      expect(yield* handle.output.text).toBe('Called the right one.');
      expect(model.calls).toHaveLength(3);
      const steps = yield* handle.output.steps;
      const spelled = steps[0]?.response?.messages?.find((message) => message.role === 'tool')?.content[0];
      expect(spelled).toMatchObject({ type: 'tool-result', id: 'call-1', name: 'mcp__tagma__side_effect' });
      expect(JSON.stringify(spelled)).toMatch(/(?<![\w-])side_effect/);
      const absent = steps[1]?.response?.messages?.find((message) => message.role === 'tool')?.content[0];
      expect(absent).toMatchObject({ type: 'tool-result', id: 'call-2', name: 'nowhere' });
    }),
  );
  it.live(
    'a call a reader answers is refused for invalid arguments instead of ending the run',
    Effect.fnUntraced(function* () {
      const model = fakeModel((callNumber) =>
        callNumber === 1 ? toolCallTurn('ask_reader', 'call-1', { prompt: 7 }) : textTurn('Asked it in words this time.'),
      );
      const handle = yield* runner(model).run(askingAgent(), {
        ...input('run-invalid-ask'),
        approval: { mode: 'trust' as const, interactive: true },
        modeOf: builtinMode('trust'),
      });
      expect(yield* handle.output.text).toBe('Asked it in words this time.');
      expect(model.calls).toHaveLength(2);
      const steps = yield* handle.output.steps;
      const answered = steps[0]?.response?.messages?.find((message) => message.role === 'tool')?.content[0];
      expect(answered).toMatchObject({ type: 'tool-result', id: 'call-1', name: 'ask_reader' });
      expect(JSON.stringify(answered)).toContain('invalid arguments');
    }),
  );
  it.live(
    'a call a reader answers with valid arguments stays unresolved for that reader',
    Effect.fnUntraced(function* () {
      const model = fakeModel(() => toolCallTurn('ask_reader', 'call-1', { prompt: 'Which branch?' }));
      const handle = yield* runner(model).run(askingAgent(), {
        ...input('run-valid-ask'),
        approval: { mode: 'trust' as const, interactive: true },
        modeOf: builtinMode('trust'),
      });
      const steps = yield* handle.output.steps;
      expect(model.calls).toHaveLength(1);
      expect(steps.at(-1)?.toolCalls.map((call) => call.toolCallId)).toEqual(['call-1']);
      expect(steps.at(-1)?.toolResults).toEqual([]);
    }),
  );
  it.live(
    'a refused call reaches the reader as denied and the model as its refusal',
    Effect.fnUntraced(function* () {
      let runs = 0;
      const model = fakeModel((callNumber) => (callNumber === 1 ? toolCallTurn('side_effect', 'call-1') : textTurn('It was refused.')));
      const handle = yield* runner(model).run(
        mutatingAgent(() => {
          runs += 1;
          return 'done';
        }),
        { ...input('run-denied-call'), approval: { mode: 'review' as const, interactive: false }, modeOf: builtinMode('review') },
      );
      const seen: AgentEvent[] = [];
      yield* Stream.runForEach(handle.recording.stream(), (event) =>
        Effect.sync(() => {
          seen.push(event);
        }),
      );
      const steps = yield* handle.output.steps;
      expect(runs).toBe(0);
      expect(seen.filter((event) => event.type === 'tool-outcome')).toMatchObject([{ outcome: { kind: 'denied' } }]);
      expect(seen.map((event) => event.type)).not.toContain('tool-result');
      expect(steps[0]?.toolResults).toEqual([]);
      const recorded = steps[0]?.content.find((part) => part.type === 'tool-result');
      expect(recorded?.type === 'tool-result' && recorded.result).toMatchObject({
        type: 'error',
        value: { status: 'refused', code: 'no-approver' },
      });
      const messages = steps[0]?.response?.messages ?? [];
      const toolMessage = messages.find((message) => message.role === 'tool');
      expect(toolMessage?.content).toMatchObject([
        { result: { type: 'text', value: expect.stringMatching(/^refused\[no-approver\]: /u) } },
      ]);
    }),
  );
  it.live(
    'the same call runs when the run trusts it',
    Effect.fnUntraced(function* () {
      let runs = 0;
      const model = fakeModel((callNumber) => (callNumber === 1 ? toolCallTurn('side_effect', 'call-1') : textTurn('Changed it.')));
      const handle = yield* runner(model).run(
        mutatingAgent(() => {
          runs += 1;
          return 'done';
        }),
        input('run-trusts-the-call'),
      );
      expect(yield* handle.output.text).toBe('Changed it.');
      expect(runs).toBe(1);
    }),
  );
  it.live(
    'a mid-run overflow retries that call once through the compacted projection',
    Effect.fnUntraced(function* () {
      const contextModes: [number, boolean][] = [];
      const model = fakeModel((callNumber) => {
        if (callNumber === 1) return toolCallTurn('side_effect', 'call-1');
        if (callNumber === 2) return contextOverflowTurn();
        return textTurn('Recovered mid-run.');
      });
      const handle = yield* runner(model).run(
        sideEffectAgent(() => 'done'),
        {
          ...input('run-midrun-overflow'),
          context: projecting((context) =>
            Effect.sync(() => {
              contextModes.push([context.stepNumber, context.contextOverflow]);
              return { messages: context.messages };
            }),
          ),
        },
      );
      expect(yield* handle.output.text).toBe('Recovered mid-run.');
      expect(model.calls).toHaveLength(3);
      expect(contextModes).toEqual([
        [0, false],
        [1, false],
        [1, true],
      ]);
      expect(yield* handle.output.steps).toHaveLength(2);
    }),
  );
  it.live(
    'every billed call is observed once, before its tools run, with what it actually sent',
    Effect.fnUntraced(function* () {
      const order: string[] = [];
      const observed: {
        step: number;
        attempt: number;
        messages: number;
        input: number | undefined;
      }[] = [];
      const model = fakeModel((callNumber) => (callNumber === 1 ? toolCallTurn('side_effect', 'call-1') : textTurn('Done.')));
      const handle = yield* runner(model).run(
        sideEffectAgent(() => {
          order.push('tool');
          return 'done';
        }),
        {
          ...input('run-call-observed'),
          context: projecting(
            (context) => Effect.succeed({ messages: context.messages }),
            (request, usage) =>
              Effect.sync(() => {
                order.push(`observe:${request.stepNumber}`);
                observed.push({
                  step: request.stepNumber,
                  attempt: request.attempt,
                  messages: request.messages.length,
                  input: usage?.inputTokens,
                });
                return undefined;
              }),
          ),
        },
      );
      expect(yield* handle.output.text).toBe('Done.');
      expect(observed.map((call) => [call.step, call.attempt, call.input])).toEqual([
        [0, 0, USAGE.inputTokens],
        [1, 0, USAGE.inputTokens],
      ]);
      expect(order).toEqual(['observe:0', 'tool', 'observe:1']);
      expect(observed[0]?.messages).toBeGreaterThan(0);
    }),
  );
  it.live(
    'the wire receives the lowered messages while the measurement and the next step carry the projected form',
    Effect.fnUntraced(function* () {
      const reference = 'attachment://thread/picture-1';
      const referenced = Message.user([{ type: 'media', mediaType: 'image/png', data: reference }]);
      const bytes = new Uint8Array([137, 80, 78, 71]);
      const observed: unknown[] = [];
      const projected: unknown[] = [];
      const model = fakeModel((callNumber) => (callNumber === 1 ? toolCallTurn('side_effect', 'call-1') : textTurn('Seen.')));
      const handle = yield* runner(model).run(
        sideEffectAgent(() => 'done'),
        {
          ...input('run-lowers-at-the-wire'),
          messages: [referenced],
          context: {
            project: (context) =>
              Effect.sync(() => {
                projected.push(firstMediaData(context.messages));
                return { messages: context.messages };
              }),
            lower: (messages) =>
              Effect.succeed(
                messages.map((message) =>
                  message === referenced ? Message.user([{ type: 'media', mediaType: 'image/png', data: bytes }]) : message,
                ),
              ),
            observe: (request) =>
              Effect.sync(() => {
                observed.push(firstMediaData(request.messages));
                return undefined;
              }),
          },
        },
      );
      expect(yield* handle.output.text).toBe('Seen.');
      expect(model.calls.map((call) => firstMediaData(call.messages))).toEqual([bytes, bytes]);
      expect(observed).toEqual([reference, reference]);
      expect(projected).toEqual([reference, reference]);
    }),
  );
  it.live(
    'a model that takes no images still receives the words its host lowers beside a picture',
    Effect.fnUntraced(function* () {
      const referenced = Message.user([
        { type: 'media', mediaType: 'image/png', data: 'attachment://thread/picture-2', filename: 'shot.png' },
      ]);
      const kept = '[This picture is kept at /kept/shot.png]';
      const model = fakeModel(() => textTurn('Seen.'));
      const handle = yield* runner({ ...model, request: { ...model.request, images: false } }).run(
        sideEffectAgent(() => 'done'),
        {
          ...input('run-blind-lowers-first'),
          messages: [referenced],
          context: {
            project: (context) => Effect.succeed({ messages: context.messages }),
            lower: (messages) =>
              Effect.succeed(
                messages.map((message) =>
                  message === referenced
                    ? Message.user([
                        { type: 'media', mediaType: 'image/png', data: new Uint8Array([137, 80, 78, 71]), filename: 'shot.png' },
                        { type: 'text', text: kept },
                      ])
                    : message,
                ),
              ),
            observe: () => Effect.succeed(undefined),
          },
        },
      );
      expect(yield* handle.output.text).toBe('Seen.');
      const parts = model.calls[0]?.messages.flatMap((message) => message.content) ?? [];
      expect(parts.some((part) => part.type === 'media')).toBe(false);
      expect(parts.some((part) => part.type === 'text' && part.text === kept)).toBe(true);
    }),
  );
  it.live(
    'a successful request closes unfinished arguments before the next step while executing its announced calls',
    Effect.fnUntraced(function* () {
      const model = fakeModel((callNumber) =>
        callNumber === 1
          ? {
              events: [
                { type: 'step-start', index: 0 },
                { type: 'tool-input-start', id: 'partial', name: 'write' },
                { type: 'tool-input-delta', id: 'partial', name: 'write', text: '{"filePath":"unfinished' },
                { type: 'tool-call', id: 'complete', name: 'write', input: { filePath: 'file', content: 'saved' } },
                { type: 'step-finish', index: 0, reason: 'tool-calls' },
                finished('tool-calls'),
              ],
            }
          : textTurn('Done.'),
      );
      const handle = yield* runner(model).run(writingAgent(), input('completed-request-parts'));
      expect(yield* handle.output.text).toBe('Done.');
      const firstStep: AgentEvent[] = [];
      for (const event of handle.recording.entries()) {
        if (event.type === 'step-start' && event.index === 1) break;
        firstStep.push(event);
      }
      expect(firstStep.filter((event) => event.type === 'tool-input-interrupted' || event.type === 'tool-outcome')).toMatchObject([
        { type: 'tool-input-interrupted', toolCallId: 'partial' },
        { type: 'tool-outcome', toolCallId: 'complete', outcome: { kind: 'answered', output: 'written' } },
      ]);
    }),
  );
  it.live(
    'an input-derived tool form reaches the stream before execution and settles under the same call',
    Effect.fnUntraced(function* () {
      const order: string[] = [];
      const model = fakeModel((callNumber) =>
        callNumber === 1 ? toolCallTurn('command', 'call-1', { command: 'printf hello' }) : textTurn('Done.'),
      );
      const displaying = new Agent<Record<string, never>>({
        id: 'displaying-agent',
        name: 'Displaying agent',
        description: 'Exercises a tool form across execution.',
        stopWhen: [stepLimit(TEST_MAX_STEPS)],
        instructions: () => 'Run the command.',
        tools: () => ({
          command: Tool.make({
            approval: ASKS_NEVER,
            description: 'Run one command.',
            parameters: Schema.Struct({ command: Schema.String }),
            display: ({ command }) => {
              order.push('display');
              return command === undefined
                ? { form: 'none', title: 'Run the command' }
                : { form: 'command', title: 'Run the command', command };
            },
            execute: ({ command }) =>
              Effect.sync(() => {
                order.push('execute');
                return new Tool.ToolAnswer('hello', {
                  form: 'command',
                  title: 'Run the command',
                  command,
                  output: 'hello',
                });
              }),
          }),
        }),
      });
      const handle = yield* runner(model).run(displaying, input('run-tool-display'));
      const seen: AgentEvent[] = [];
      yield* Stream.runForEach(handle.recording.stream(), (event) =>
        Effect.sync(() => {
          seen.push(event);
        }),
      );
      expect(yield* handle.output.text).toBe('Done.');
      expect(order).toEqual(['display', 'execute']);
      expect(seen.filter((event) => event.type === 'tool-display' || event.type === 'tool-outcome').map((event) => event.type)).toEqual([
        'tool-display',
        'tool-display',
        'tool-outcome',
      ]);
    }),
  );
  it.live(
    'publishes a completed streamed subject once, never from a half-written title field, and settles one row',
    Effect.fnUntraced(function* () {
      const callInput = { name: 'critic', model: { model: 'gpt-test' }, task: 'x'.repeat(16 * 1024) };
      const callText = JSON.stringify(callInput);
      const splitAt = callText.indexOf('critic') + 4;
      const fragments = [callText.slice(0, splitAt)];
      for (let start = splitAt; start < callText.length; start += 2 * 1024) {
        fragments.push(callText.slice(start, start + 2 * 1024));
      }
      const model = fakeModel((callNumber) =>
        callNumber === 1
          ? {
              events: [
                { type: 'step-start', index: 0 },
                { type: 'tool-input-start', id: 'call-streaming', name: 'delegate' },
                ...fragments.map((text) => ({
                  type: 'tool-input-delta' as const,
                  id: 'call-streaming',
                  name: 'delegate',
                  text,
                })),
                { type: 'tool-call', id: 'call-streaming', name: 'delegate', input: callInput },
                { type: 'step-finish', index: 0, reason: 'tool-calls' },
                finished('tool-calls'),
              ],
            }
          : textTurn('Done.'),
      );
      const displaying = new Agent<Record<string, never>>({
        id: 'streaming-display-agent',
        name: 'Streaming display agent',
        description: 'Exercises a tool subject while its input streams.',
        stopWhen: [stepLimit(TEST_MAX_STEPS)],
        instructions: () => 'Delegate the work.',
        tools: () => ({
          delegate: Tool.make({
            approval: ASKS_NEVER,
            description: 'Delegate one commission.',
            parameters: Schema.Struct({
              name: Schema.String,
              model: Schema.Struct({ model: Schema.String }),
              task: Schema.String,
            }),
            display: {
              streamFields: ['name', 'model'],
              project: (call) =>
                call.name === undefined || call.model === undefined
                  ? { form: 'none' }
                  : { form: 'text', title: `${call.name} · ${call.model.model}`, text: call.task ?? '' },
            },
            execute: () => Effect.succeed(new Tool.ToolAnswer('delegated', { form: 'none', title: 'settled' })),
          }),
        }),
      });
      const handle = yield* runner(model).run(displaying, input('run-streaming-tool-display'));
      const seen: AgentEvent[] = [];
      yield* Stream.runForEach(handle.recording.stream(), (event) =>
        Effect.sync(() => {
          seen.push(event);
        }),
      );
      const partial = seen.findIndex((event) => event.type === 'tool-input-delta' && event.text.includes('"task":"'));
      const provisional = seen.findIndex((event) => event.type === 'tool-display');
      const available = seen.findIndex((event) => event.type === 'tool-call' && event.id === 'call-streaming');
      expect(provisional).toBeGreaterThan(partial);
      expect(provisional).toBeLessThan(available);
      expect(seen.flatMap((event) => (event.type === 'tool-display' ? [event.display.title] : []))).toEqual([
        'critic · gpt-test',
        'critic · gpt-test',
        'settled',
      ]);
      expect(seen.filter((event) => event.type === 'tool-outcome' && event.toolCallId === 'call-streaming')).toMatchObject([
        { outcome: { kind: 'answered' } },
      ]);
    }),
  );
  it.live(
    'a streamed subject refines as fields close, and never waits for one the call omits',
    Effect.fnUntraced(function* () {
      const callInput = { agentId: 'reviewer', name: 'critic', task: 'A long commission still streaming.' };
      const model = fakeModel((callNumber) =>
        callNumber === 1
          ? {
              events: [
                { type: 'step-start', index: 0 },
                { type: 'tool-input-start', id: 'call-refining', name: 'delegate' },
                { type: 'tool-input-delta', id: 'call-refining', name: 'delegate', text: '{"agentId":"revie' },
                { type: 'tool-input-delta', id: 'call-refining', name: 'delegate', text: 'wer","name":"cri' },
                { type: 'tool-input-delta', id: 'call-refining', name: 'delegate', text: 'tic","task":"A long' },
                {
                  type: 'tool-input-delta',
                  id: 'call-refining',
                  name: 'delegate',
                  text: ' commission still streaming."}',
                },
                { type: 'tool-call', id: 'call-refining', name: 'delegate', input: callInput },
                { type: 'step-finish', index: 0, reason: 'tool-calls' },
                finished('tool-calls'),
              ],
            }
          : textTurn('Done.'),
      );
      const refining = new Agent<Record<string, never>>({
        id: 'refining-display-agent',
        name: 'Refining display agent',
        description: 'Exercises a tool subject that arrives field by field.',
        stopWhen: [stepLimit(TEST_MAX_STEPS)],
        instructions: () => 'Delegate the work.',
        tools: () => ({
          delegate: Tool.make({
            approval: ASKS_NEVER,
            description: 'Delegate one commission.',
            parameters: Schema.Struct({
              agentId: Schema.String,
              model: Schema.optional(Schema.Struct({ model: Schema.String })),
              name: Schema.optional(Schema.String),
              task: Schema.String,
            }),
            display: {
              streamFields: ['agentId', 'name', 'model'],
              project: (call) => ({
                form: 'text',
                title: [call.name ?? call.agentId, call.model?.model].filter((part) => part !== undefined).join(' · '),
                text: call.task ?? '',
              }),
            },
            execute: () => Effect.succeed(new Tool.ToolAnswer('delegated', { form: 'none', title: 'settled' })),
          }),
        }),
      });
      const handle = yield* runner(model).run(refining, input('run-refining-tool-display'));
      const seen: AgentEvent[] = [];
      yield* Stream.runForEach(handle.recording.stream(), (event) =>
        Effect.sync(() => {
          seen.push(event);
        }),
      );
      expect(seen.flatMap((event) => (event.type === 'tool-display' ? [event.display.title] : []))).toEqual([
        'reviewer',
        'critic',
        'critic',
        'settled',
      ]);
      const streaming = seen.slice(
        0,
        seen.findIndex((event) => event.type === 'tool-call'),
      );
      expect(streaming.some((event) => event.type === 'tool-outcome')).toBe(false);
      expect(streaming.findLast((event) => event.type === 'tool-display')).toMatchObject({ display: { title: 'critic' } });
    }),
  );
  it.live(
    'a tool without a declared display stays mute until its ordinary settled form',
    Effect.fnUntraced(function* () {
      const model = fakeModel((callNumber) =>
        callNumber === 1
          ? {
              events: [
                { type: 'step-start', index: 0 },
                { type: 'tool-input-start', id: 'call-plain', name: 'side_effect' },
                { type: 'tool-input-delta', id: 'call-plain', name: 'side_effect', text: '{}' },
                { type: 'tool-call', id: 'call-plain', name: 'side_effect', input: {} },
                { type: 'step-finish', index: 0, reason: 'tool-calls' },
                finished('tool-calls'),
              ],
            }
          : textTurn('Done.'),
      );
      const handle = yield* runner(model).run(
        sideEffectAgent(() => 'done'),
        input('run-plain-tool-streaming'),
      );
      const seen: AgentEvent[] = [];
      yield* Stream.runForEach(handle.recording.stream(), (event) =>
        Effect.sync(() => {
          seen.push(event);
        }),
      );
      const available = seen.findIndex((event) => event.type === 'tool-call' && event.id === 'call-plain');
      const firstDisplay = seen.findIndex((event) => event.type === 'tool-display');
      expect(firstDisplay).toBeGreaterThan(available);
    }),
  );
  it.live(
    'the step frames on the wire before the loop publishes its tool outcome',
    Effect.fnUntraced(function* () {
      const model = fakeModel((callNumber) => (callNumber === 1 ? toolCallTurn('side_effect', 'call-1') : textTurn('Done.')));
      const handle = yield* runner(model).run(
        sideEffectAgent(() => 'done'),
        input('run-execute-after-close'),
      );
      const chunks: {
        type: string;
      }[] = [];
      yield* Stream.runForEach(handle.recording.stream(), (chunk) =>
        Effect.sync(() => {
          chunks.push(
            chunk as {
              type: string;
            },
          );
        }),
      );
      const finishStep = chunks.findIndex((chunk) => chunk.type === 'step-finish');
      const outcome = chunks.findIndex((chunk) => chunk.type === 'tool-outcome');
      expect(finishStep).toBeGreaterThanOrEqual(0);
      expect(outcome).toBeGreaterThan(finishStep);
    }),
  );
  it.live(
    'the loop mints one run-start and one run-finish, and answers the terminal reason',
    Effect.fnUntraced(function* () {
      const model = fakeModel((callNumber) => (callNumber === 1 ? toolCallTurn('side_effect', 'call-1') : textTurn('Done.')));
      const handle = yield* runner(model).run(
        sideEffectAgent(() => 'done'),
        input('run-finish-chunk'),
      );
      const chunks: {
        type: string;
      }[] = [];
      yield* Stream.runForEach(handle.recording.stream(), (chunk) =>
        Effect.sync(() => {
          chunks.push(
            chunk as {
              type: string;
            },
          );
        }),
      );
      expect(chunks.filter((chunk) => chunk.type === 'run-start')).toHaveLength(1);
      expect(chunks.filter((chunk) => chunk.type === 'run-finish')).toHaveLength(1);
      expect(chunks.at(-1)?.type).toBe('run-finish');
      expect(yield* handle.output.finishReason).toBe('stop');
      expect(chunks.filter((chunk) => chunk.type === 'step-finish').length).toBeGreaterThanOrEqual(2);
    }),
  );
  it.live(
    'an empty final gets one guided chance to answer, then fails rather than completing silently',
    Effect.fnUntraced(function* () {
      const recovered = fakeModel((callNumber) => (callNumber === 1 ? emptyFinishTurn() : textTurn('A visible answer.')));
      const first = yield* runner(recovered).run(agent(), input('run-empty-recovered'));
      expect(yield* first.output.text).toBe('A visible answer.');
      expect(recovered.calls).toHaveLength(2);
      expect(recovered.calls[1]?.messages.some((message) => agentOriginOf(message) === 'guidance')).toBe(true);
      const silent = fakeModel(() => emptyFinishTurn());
      const second = yield* runner(silent).run(agent(), input('run-empty-failed'));
      const events: AgentEvent[] = [];
      const failure = yield* Effect.flip(
        Stream.runForEach(second.recording.stream(), (event) =>
          Effect.sync(() => {
            events.push(event);
          }),
        ),
      );
      expect(failure).toMatchObject({ _tag: 'AgentRunBroke' });
      expect(silent.calls).toHaveLength(2);
      expect(events.some((event) => event.type === 'run-finish')).toBe(false);
      expect(yield* streamCause(second)).toBeInstanceOf(Error);
      expect(second.completedSteps()).toHaveLength(2);
    }),
  );
  it.live(
    'a critical rule that throws around a tool ends the run instead of becoming its error',
    Effect.fnUntraced(function* () {
      let runs = 0;
      const model = fakeModel(() => toolCallTurn('side_effect', 'call-1'));
      const gated = new Agent<Record<string, never>>({
        id: 'gated-agent',
        name: 'Gated agent',
        description: 'Exercises a capability gate that breaks around a call.',
        stopWhen: [stepLimit(TEST_MAX_STEPS)],
        instructions: () => 'Run the tool once.',
        tools: () => ({
          side_effect: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_NEVER,
            description: 'Run one externally visible side effect.',
            parameters: Schema.Struct({}),
            execute: () =>
              Effect.sync(() => {
                runs += 1;
                return 'done';
              }),
          }),
        }),
        rules: [
          agentRule<Record<string, never>>(
            'capability-gate',
            (ctx) => {
              if (ctx.hook !== 'beforeTool') return null;
              throw new Error('gate broke');
            },
            { owner: 'test', critical: true },
          ),
        ],
      });
      const handle = yield* runner(model).run(gated, input('run-gate-breaks'));
      expect(yield* Effect.matchCause(handle.output.text, { onFailure: Cause.squash, onSuccess: () => null })).toMatchObject({
        message: expect.stringContaining('gate broke'),
      });
      expect(runs).toBe(0);
      expect(handle.completedSteps()).toHaveLength(0);
    }),
  );
  it.live(
    'a beforeTool rule refuses one call with its reason and runs another on the input it rewrote',
    Effect.fnUntraced(function* () {
      const ran: string[] = [];
      const model = fakeModel((callNumber) =>
        callNumber === 1
          ? toolCallTurn('echo', 'call-denied', { text: 'rm -rf /' })
          : callNumber === 2
            ? toolCallTurn('echo', 'call-rewritten', { text: 'draft' })
            : textTurn('Done.'),
      );
      const guarded = new Agent<Record<string, never>>({
        id: 'guarded-agent',
        name: 'Guarded agent',
        description: 'Exercises a rule that judges each call.',
        stopWhen: [stepLimit(TEST_MAX_STEPS)],
        instructions: () => 'Echo twice.',
        tools: () => ({
          echo: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_NEVER,
            description: 'Echo the text.',
            parameters: Schema.Struct({ text: Schema.String }),
            execute: ({ text }) =>
              Effect.sync(() => {
                ran.push(text);
                return text;
              }),
          }),
        }),
        rules: [
          agentRule<Record<string, never>>(
            'call-guard',
            (ctx) => {
              if (ctx.hook !== 'beforeTool' || ctx.tool === undefined) return null;
              if (ctx.tool.toolCallId === 'call-denied') return { type: 'deny', reason: 'destructive commands are blocked' };
              return { type: 'rewrite', input: { text: 'final' } };
            },
            { owner: 'test' },
          ),
        ],
      });
      const handle = yield* runner(model).run(guarded, input('run-guarded'));
      expect(yield* handle.output.text).toBe('Done.');
      expect(ran).toEqual(['final']);
      expect(JSON.stringify(model.calls[1]?.messages)).toContain('destructive commands are blocked');
    }),
  );
  it.live(
    'a call rewritten onto another call’s target is ordered by the rewritten target',
    Effect.fnUntraced(function* () {
      const order: string[] = [];
      const model = fakeModel((callNumber) =>
        callNumber === 1
          ? parallelToolCallTurn([
              { name: 'write', id: 'write', input: { filePath: 'draft.md' } },
              { name: 'read', id: 'read', input: { filePath: 'final.md' } },
            ])
          : textTurn('Done.'),
      );
      const fileTool = (access: 'read' | 'write') =>
        Tool.make({
          display: () => ({ form: 'none' }),
          approval: ASKS_NEVER,
          description: `${access} one file.`,
          parameters: Schema.Struct({ filePath: Schema.String }),
          claims: ({ filePath }) => Effect.succeed([{ on: { kind: 'file' as const, path: filePath }, access }]),
          execute: Effect.fnUntraced(function* ({ filePath }) {
            order.push(`${access}:start:${filePath}`);
            yield* Effect.yieldNow;
            order.push(`${access}:end:${filePath}`);
            return filePath;
          }),
        });
      const redirected = new Agent<Record<string, never>>({
        id: 'redirected-agent',
        name: 'Redirected agent',
        description: 'Exercises ordering over a rewritten input.',
        stopWhen: [stepLimit(TEST_MAX_STEPS)],
        instructions: () => 'Write, then read.',
        tools: () => ({ write: fileTool('write'), read: fileTool('read') }),
        rules: [
          agentRule<Record<string, never>>(
            'redirect',
            (ctx) =>
              ctx.hook === 'beforeTool' && ctx.tool?.name === 'write' ? { type: 'rewrite', input: { filePath: 'final.md' } } : null,
            { owner: 'test' },
          ),
        ],
      });
      const handle = yield* runner(model).run(redirected, input('run-redirected'));
      expect(yield* handle.output.text).toBe('Done.');
      expect(order.indexOf('write:end:final.md')).toBeLessThan(order.indexOf('read:start:final.md'));
    }),
  );
  it.live(
    'a stopped run ends with the reason given and stops the tool it was waiting on',
    Effect.fnUntraced(function* () {
      const running = createDeferred<void>();
      const model = fakeModel(() => toolCallTurn('side_effect', 'call-1'));
      const hanging = new Agent<Record<string, never>>({
        id: 'hanging-agent',
        name: 'Hanging agent',
        description: 'Exercises cancellation while a tool is in flight.',
        stopWhen: [stepLimit(TEST_MAX_STEPS)],
        instructions: () => 'Run the tool once.',
        tools: () => ({
          side_effect: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_NEVER,
            description: 'Never answers on its own.',
            parameters: Schema.Struct({}),
            execute: () =>
              Effect.promise(() => {
                running.resolve();
                return new Promise<string>(() => undefined);
              }),
          }),
        }),
      });
      const handle = yield* runner(model).run(hanging, input('run-cancelled'));
      const seen: string[] = [];
      const reading = yield* Effect.forkScoped(
        Effect.matchCause(
          Stream.runForEach(handle.recording.stream(), (chunk) =>
            Effect.sync(() => {
              seen.push(
                (
                  chunk as {
                    type: string;
                  }
                ).type,
              );
            }),
          ),
          { onFailure: Cause.squash, onSuccess: () => null },
        ),
      );
      const reason = new Error('the reader left');
      yield* Effect.promise(() => running.promise);
      yield* handle.stop(reason);
      const failure = yield* Effect.match(handle.output.text, { onSuccess: () => null, onFailure: (error: unknown) => error });
      expect(failure).toMatchObject({ cause: reason });
      expect(yield* Fiber.join(reading)).toMatchObject({ cause: reason });
      expect(seen).toContain('run-abort');
      expect(yield* streamCause(handle)).toBe(reason);
    }),
  );
  it.live(
    'a stopped run takes the door’s answer for each call: a started one is unknown, a queued one cancelled, a wait answered',
    Effect.fnUntraced(function* () {
      const started = createDeferred<void>();
      const watching = createDeferred<void>();
      const model = fakeModel((callNumber) =>
        callNumber === 1
          ? parallelToolCallTurn([
              { name: 'write', id: 'first', input: { filePath: 'notes/a.md' } },
              { name: 'write', id: 'second', input: { filePath: 'notes/a.md' } },
              { name: 'wait', id: 'wait', input: {} },
            ])
          : textTurn('Done.'),
      );
      const stopping = new Agent<Record<string, never>>({
        id: 'stopping-agent',
        name: 'Stopping agent',
        description: 'Exercises the outcomes a stop leaves.',
        stopWhen: [stepLimit(TEST_MAX_STEPS)],
        instructions: () => 'Run every call.',
        tools: () => ({
          write: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_NEVER,
            description: 'Write one file and never finish.',
            parameters: Schema.Struct({ filePath: Schema.String }),
            mutates: true,
            claims: ({ filePath }) => Effect.succeed([{ on: { kind: 'file' as const, path: filePath }, access: 'write' as const }]),
            execute: () =>
              Effect.andThen(
                Effect.sync(() => started.resolve()),
                Effect.never,
              ),
          }),
          wait: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_NEVER,
            description: 'Watch until the wait is ended.',
            parameters: Schema.Struct({}),
            claims: () => Effect.succeed([{ on: { kind: 'key' as const, key: 'call:watched' }, access: 'read' as const }]),
            execute: (_input, call) =>
              Effect.andThen(
                Effect.sync(() => {
                  call.progress?.watch();
                  watching.resolve();
                }),
                Effect.never,
              ),
          }),
        }),
      });
      const handle = yield* runner(model).run(stopping, input('run-stopped-calls'));
      yield* Effect.promise(() => started.promise);
      yield* Effect.promise(() => watching.promise);
      yield* handle.stop(new Error('the operator stopped the run'));
      yield* Effect.exit(handle.output.text);
      const outcomes = Object.fromEntries(
        handle.recording.entries().flatMap((event) => (event.type === 'tool-outcome' ? [[event.toolCallId, event.outcome.kind]] : [])),
      );
      expect(outcomes).toEqual({ first: 'unknown', second: 'cancelled', wait: 'answered' });
      expect(
        handle
          .completedSteps()
          .flatMap((step) => step.content.flatMap((part) => (part.type === 'tool-result' ? [part.id] : [])))
          .sort(),
      ).toEqual(['first', 'second', 'wait']);
    }),
  );
  it.live(
    'a binder defect ends the run with what broke, and every reader learns it',
    Effect.fnUntraced(function* () {
      const broke = new Error('the binder let a parse error escape its stream');
      const model = fakeModel(() => brokenTurn(broke));
      const handle = yield* runner(model).run(agent(), input('run-binder-stream'));
      const reading = yield* Effect.forkScoped(
        Effect.matchCause(
          Stream.runForEach(handle.recording.stream(), (chunk) =>
            Effect.sync(() => {
              void chunk;
            }),
          ),
          { onFailure: Cause.squash, onSuccess: () => null },
        ),
      );
      expect(yield* Effect.matchCause(handle.output.text, { onFailure: Cause.squash, onSuccess: () => null })).toMatchObject({
        cause: broke,
      });
      expect(yield* Fiber.join(reading)).toMatchObject({ cause: broke });
      expect(yield* streamCause(handle)).toBe(broke);
      expect(handle.completedSteps()).toHaveLength(0);
    }),
  );
  it.live(
    'a reader that arrives after a failed run replays every event and then the failure',
    Effect.fnUntraced(function* () {
      const failure = doorFailure(new Error('Provider stream failed after partial output.'));
      const model = fakeModel(() => failedTextTurn('Partial reply.', failure));
      const handle = yield* runner(model).run(agent(), input('run-replay-after-failure'));
      expect(yield* Effect.matchCause(handle.output.text, { onFailure: Cause.squash, onSuccess: () => null })).toMatchObject({
        message: expect.stringContaining(failure.message),
      });
      const seen: string[] = [];
      const late = yield* Effect.matchCause(
        Stream.runForEach(handle.recording.stream(), (chunk) =>
          Effect.sync(() => {
            seen.push(
              (
                chunk as {
                  type: string;
                }
              ).type,
            );
          }),
        ),
        { onFailure: Cause.squash, onSuccess: () => null },
      );
      expect(late).toMatchObject({ cause: failure });
      expect(seen[0]).toBe('run-start');
      expect(seen).toContain('text-delta');
    }),
  );
  it.live(
    'a mid-run provider failure keeps the earlier committed step and rejects the run',
    Effect.fnUntraced(function* () {
      const failure = doorFailure(new Error('Provider died on the second call.'));
      const model = fakeModel((callNumber) =>
        callNumber === 1 ? toolCallTurn('side_effect', 'call-1') : failedTextTurn('Second call words.', failure),
      );
      const handle = yield* runner(model).run(
        sideEffectAgent(() => 'done'),
        input('run-midrun-failure'),
      );
      expect(yield* Effect.matchCause(handle.output.text, { onFailure: Cause.squash, onSuccess: () => null })).toMatchObject({
        message: expect.stringContaining(failure.message),
      });
      expect(handle.completedSteps()).toHaveLength(2);
      expect(handle.completedSteps()[1]?.text).toBe('Second call words.');
      expect(yield* streamCause(handle)).toBe(failure);
    }),
  );
});
describe('AgentRunner step retry', () => {
  const input = (runId: string): RecordedInput<Record<string, never>> => ({
    runId,
    ctx: {},
    model: { ownerId: 'owner-1', provider: 'openai-oauth', model: 'gpt-5.5', reasoning: 'high', switches: {} },
    messages: [Message.user('Answer.')],
    approval: { mode: 'trust', interactive: false },
    modeOf: builtinMode('trust'),
  });
  const collect = (handle: RecordedRun) => Stream.runCollect(handle.recording.stream());
  it.live(
    'a stream torn after shown words is asked again: one retry announced, one step begun, the second answer kept',
    Effect.fnUntraced(function* () {
      const model = fakeModel((callNumber) =>
        callNumber === 1 ? failedTextTurn('First words, cut', tornStream()) : textTurn('Whole answer.'),
      );
      const recording = activityRecording();
      const handle = yield* runner(model, recording.log).run(agent(), input('run-retry-torn'));
      const chunks = yield* collect(handle);
      expect(yield* handle.output.text).toBe('Whole answer.');
      expect(model.calls).toHaveLength(2);
      expect(model.calls[1]?.messages.some((message) => message.role === 'assistant')).toBe(false);
      const types = chunks.map((chunk) => chunk.type);
      expect(types.filter((type) => type === 'step-start')).toHaveLength(1);
      const retry = chunks.find((chunk) => chunk.type === 'retry');
      expect(retry).toMatchObject({ type: 'retry', stepNumber: 0, attempt: 1, of: 5, family: 'torn-stream' });
      expect(types.indexOf('retry')).toBeGreaterThan(types.indexOf('text-delta'));
      expect(types.indexOf('retry')).toBeLessThan(types.lastIndexOf('text-delta'));
      expect(handle.completedSteps()).toHaveLength(1);
      expect(handle.completedSteps()[0]?.text).toBe('Whole answer.');
      expect(recording.activities().some((recorded) => recorded.notes.some((note) => note.type === 'step-retry'))).toBe(true);
    }),
  );
  it.live(
    'an abandoned tool input ends before the retry and cannot remain live beside the next attempt',
    Effect.fnUntraced(function* () {
      const model = fakeModel((callNumber) =>
        callNumber === 1
          ? {
              events: [
                { type: 'step-start', index: 0 },
                { type: 'tool-input-start', id: 'abandoned', name: 'read' },
                { type: 'tool-input-delta', id: 'abandoned', name: 'read', text: '{"path":' },
              ],
              failure: tornStream(),
            }
          : textTurn('Recovered.'),
      );
      const handle = yield* runner(model).run(agent(), input('run-input-retry'));
      const chunks = yield* collect(handle);
      const interrupted = chunks.findIndex((chunk) => chunk.type === 'tool-input-interrupted' && chunk.toolCallId === 'abandoned');
      expect(interrupted).toBeGreaterThanOrEqual(0);
      expect(interrupted).toBeLessThan(chunks.findIndex((chunk) => chunk.type === 'retry'));
      expect(chunks.some((chunk) => chunk.type === 'tool-outcome' || (chunk.type === 'tool-call' && chunk.id === 'abandoned'))).toBe(false);
      expect(handle.completedSteps().flatMap((step) => step.toolCalls)).toEqual([]);
      expect(model.calls[1]?.messages.map((message) => message.role)).toEqual(['user']);
    }),
  );
  it.live(
    'the host keeps the interrupted arguments and its notice reaches the very next request',
    Effect.fnUntraced(function* () {
      const model = fakeModel((callNumber) =>
        callNumber === 1
          ? {
              events: [
                { type: 'step-start', index: 0 },
                { type: 'tool-input-start', id: 'abandoned', name: 'write' },
                { type: 'tool-input-delta', id: 'abandoned', name: 'write', text: '{"filePath":"/tmp/a","content":"half' },
              ],
              failure: tornStream(),
            }
          : textTurn('Recovered.'),
      );
      const seen: {
        received: string;
        recovery: unknown;
      }[] = [];
      const handle = yield* runner(model).run(writingAgent(), {
        ...input('run-input-recovery'),
        recovery: {
          interrupted: ({ calls }) =>
            Effect.sync(() => {
              for (const call of calls) seen.push({ received: call.received, recovery: call.recovery });
              return [{ hook: 'beforeStep' as const, text: 'The draft is at /scratch/interrupted-abandoned-a.' }];
            }),
        },
      });
      yield* collect(handle);
      expect(seen).toEqual([
        { received: '{"filePath":"/tmp/a","content":"half', recovery: { content: 'content', destination: 'filePath' } },
      ]);
      const retried = model.calls[1]?.messages ?? [];
      expect(retried.some((message) => JSON.stringify(message.content).includes('/scratch/interrupted-abandoned-a'))).toBe(true);
      expect(JSON.stringify(retried)).not.toContain('"content":"half');
    }),
  );
  it.live(
    'a stream torn before any output is asked again silently, with no second step beginning',
    Effect.fnUntraced(function* () {
      const model = fakeModel((callNumber) =>
        callNumber === 1 ? { events: [{ type: 'step-start', index: 0 }], failure: tornStream() } : textTurn('Answer.'),
      );
      const handle = yield* runner(model).run(agent(), input('run-retry-silent'));
      const chunks = yield* collect(handle);
      expect(yield* handle.output.text).toBe('Answer.');
      const types = chunks.map((chunk) => chunk.type);
      expect(types.filter((type) => type === 'step-start')).toHaveLength(1);
      expect(types.filter((type) => type === 'retry')).toHaveLength(1);
      expect(types.indexOf('retry')).toBeLessThan(types.indexOf('step-start'));
    }),
  );
  it.live(
    'a refusal the wire never asks again for ends the run at once, unannounced',
    Effect.fnUntraced(function* () {
      const failure = doorFailure('That prompt is invalid.');
      const model = fakeModel(() => ({ events: [], failure }));
      const handle = yield* runner(model).run(agent(), input('run-retry-refused'));
      expect(yield* Effect.matchCause(handle.output.text, { onFailure: Cause.squash, onSuccess: () => null })).toMatchObject({
        message: expect.stringContaining(failure.message),
      });
      expect(model.calls).toHaveLength(1);
      const recorded = yield* Stream.runCollect(
        handle.recording.stream().pipe(
          Stream.filter((chunk) => chunk.type === 'retry'),
          Stream.catchTag('AgentRunBroke', () => Stream.empty),
        ),
      );
      expect(recorded).toEqual([]);
    }),
  );
  it.live.each(['torn', 'stalled', 'refused-after-retry'] as const)(
    'a %s ending carries why retries stopped and preserves the final provider cause',
    Effect.fnUntraced(function* (kind) {
      const failure =
        kind === 'stalled'
          ? new LLMError({ module: 'wire', method: 'stream', reason: new StreamStalledReason({ message: 'No frames.', idleMs: 1000 }) })
          : kind === 'refused-after-retry'
            ? doorFailure('Invalid prompt.')
            : tornStream();
      const model = fakeModel((attempt) => ({
        events: [],
        failure: kind === 'refused-after-retry' && attempt === 1 ? tornStream() : failure,
      }));
      const native = yield* makeAgentRunner({ models: { request: () => model.request }, idleMs: TEST_IDLE_MS });
      const result = yield* Effect.gen(function* () {
        const handle = yield* recordRun(native, agent(), input(`run-retry-stop-${kind}`));
        yield* TestClock.adjust('1 minute');
        const textFailure = yield* Effect.flip(handle.output.text);
        const streamFailure = yield* Effect.flip(Stream.runDrain(handle.recording.stream()));
        expect(streamFailure.cause).toBe(textFailure.cause);
        return textFailure.cause;
      }).pipe(Effect.provide(TestClock.layer()));
      expect(result).toBeInstanceOf(AgentRetryFailed);
      if (!(result instanceof AgentRetryFailed)) return yield* Effect.die(new Error('Expected the loop retry failure'));
      const retries = kind === 'torn' ? 5 : 1;
      expect(result.retry).toEqual({
        stop: kind === 'refused-after-retry' ? 'not-retryable' : 'exhausted',
        retries,
        attempts: retries + 1,
        limit: kind === 'stalled' ? 1 : 5,
      });
      expect(result.cause).toBe(failure);
      expect(model.calls).toHaveLength(retries + 1);
    }),
  );
  it.live(
    'a wait the provider names past the ceiling is not taken: the run ends at once',
    Effect.fnUntraced(function* () {
      const failure = rateLimited(90_000);
      const model = fakeModel(() => ({ events: [], failure }));
      const handle = yield* runner(model).run(agent(), input('run-retry-long-wait'));
      const broke = yield* Effect.flip(handle.output.text);
      expect(broke.cause).toBeInstanceOf(AgentRetryFailed);
      expect(broke.cause).toMatchObject({
        cause: failure,
        retry: { stop: 'delay-limit', attempts: 1, retries: 0, limit: 5, retryAfterMs: 90_000, ceilingMs: 60_000 },
      });
      expect(model.calls).toHaveLength(1);
    }),
  );
  it.live(
    'a wait the provider names under the ceiling is honoured, and the announcement carries it',
    Effect.fnUntraced(function* () {
      const model = fakeModel((callNumber) => (callNumber === 1 ? { events: [], failure: rateLimited(50) } : textTurn('Answer.')));
      const handle = yield* runner(model).run(agent(), input('run-retry-named-wait'));
      const chunks = yield* collect(handle);
      expect(yield* handle.output.text).toBe('Answer.');
      expect(chunks.find((chunk) => chunk.type === 'retry')).toMatchObject({ family: 'rate-limit', delayMs: 50 });
    }),
  );
});
describe('AgentRunner step intent', () => {
  const input = (runId: string) => ({
    runId,
    ctx: {},
    model: {
      ownerId: 'owner-1',
      provider: 'openai-oauth' as const,
      model: 'gpt-5.5',
      reasoning: 'high',
      switches: {},
    },
    messages: [Message.user('Run the side effect once.')],
    approval: { mode: 'trust' as const, interactive: false },
    modeOf: builtinMode('trust'),
  });
  it.live(
    'the intent commits before the first execute and names the call it provisions',
    Effect.fnUntraced(function* () {
      const order: string[] = [];
      const model = fakeModel((callNumber) => (callNumber === 1 ? toolCallTurn('side_effect', 'call-1') : textTurn('Done.')));
      const intents: unknown[] = [];
      const handle = yield* runner(model).run(
        sideEffectAgent(() => {
          order.push('execute');
          return 'done';
        }),
        {
          ...input('run-intent-order'),
          commitEffects: (intent) =>
            Effect.sync(() => {
              order.push(`intent:${intent.calls.map((call) => call.toolCallId).join(',')}`);
              intents.push(intent);
            }),
        },
      );
      expect(yield* handle.output.text).toBe('Done.');
      expect(order).toEqual(['intent:call-1', 'execute']);
      expect(intents[0]).toMatchObject({
        stepNumber: 0,
        calls: [{ toolCallId: 'call-1', toolName: 'side_effect' }],
        messages: [{ role: 'assistant' }],
      });
    }),
  );
  it.live(
    'a rejected intent fails the step with the effect unexecuted',
    Effect.fnUntraced(function* () {
      let executions = 0;
      const model = fakeModel(() => toolCallTurn('side_effect', 'call-1'));
      const handle = yield* runner(model).run(
        sideEffectAgent(() => {
          executions += 1;
          return 'done';
        }),
        {
          ...input('run-intent-refused'),
          commitEffects: () => Effect.fail(new AgentHostFailed({ port: 'commitEffects', cause: new Error('intent write lost') })),
        },
      );
      expect(yield* Effect.matchCause(handle.output.text, { onFailure: Cause.squash, onSuccess: () => null })).toMatchObject({
        message: expect.stringContaining('intent write lost'),
      });
      expect(executions).toBe(0);
    }),
  );
});
describe('AgentRunner prompt freeze', () => {
  const input = (runId: string) => ({
    runId,
    ctx: {},
    model: {
      ownerId: 'owner-1',
      provider: 'openai-oauth' as const,
      model: 'gpt-5.5',
      reasoning: 'high',
      switches: {},
    },
    messages: [Message.user('Hi.')],
    approval: { mode: 'trust' as const, interactive: false },
    modeOf: builtinMode('trust'),
  });
  const watching = Effect.fnUntraced(function* (order: string[], model: FakeModel) {
    const native = yield* makeAgentRunner({
      models: {
        request: (opened: { instructions: string }) => {
          order.push(`request:${opened.instructions}`);
          return model.request;
        },
      } as unknown as ModelRequester,
      idleMs: TEST_IDLE_MS,
    });
    return {
      run: <TCtx>(agent: Agent<TCtx>, input: RecordedInput<TCtx>) => recordRun(native, agent, input),
      start: <TCtx>(agent: Agent<TCtx>, input: RecordedInput<TCtx>) => Effect.forkScoped(recordRun(native, agent, input)),
    };
  });
  it.live(
    'fresh instructions are committed before the model request, and the winner runs',
    Effect.fnUntraced(function* () {
      const order: string[] = [];
      const model = fakeModel(() => textTurn('ok'));
      const handle = yield* (yield* watching(order, model)).run(agent(), {
        ...input('run-1'),
        commitInstructions: (text) =>
          Effect.sync(() => {
            order.push(`commit:${text}`);
            return 'Durable winner.';
          }),
      });
      expect(yield* handle.output.text).toBe('ok');
      expect(handle.instructions).toBe('Durable winner.');
      expect(order).toEqual(['commit:Answer the user.', 'request:Durable winner.']);
    }),
  );
  it.live(
    'interrupting a start while the instructions are being frozen ends it before the model is asked',
    Effect.fnUntraced(function* () {
      const asked = createDeferred<void>();
      const order: string[] = [];
      const parked = new Agent<Record<string, never>>({
        id: 'parked-instructions-agent',
        name: 'Parked instructions agent',
        description: 'Its instructions are never frozen.',
        stopWhen: [stepLimit(TEST_MAX_STEPS)],
        instructions: () => 'Answer the user.',
        tools: () => ({}),
      });
      const start = yield* (yield* watching(
        order,
        fakeModel(() => textTurn('ok')),
      )).start(parked, {
        ...input('run-stopped-mid-preflight'),
        commitInstructions: () =>
          Effect.andThen(
            Effect.sync(() => asked.resolve()),
            Effect.never,
          ),
      });
      yield* Effect.promise(() => asked.promise);
      const ended = yield* Fiber.interrupt(start).pipe(Effect.andThen(Fiber.await(start)));
      expect(Exit.isFailure(ended) && Cause.hasInterruptsOnly(ended.cause)).toBe(true);
      expect(order).toEqual([]);
    }),
  );
});
describe('AgentRunner accounts', () => {
  it.live(
    'a moved credential is signed with at the next step, and each step and each observed call names the account it spent',
    Effect.fnUntraced(function* () {
      const model = fakeModel((callNumber) =>
        callNumber === 1 ? toolCallTurn('side_effect', 'call-1') : textTurn('Answered on the second account.'),
      );
      const answering = ['k1', 'k2'];
      const observed: (string | undefined)[] = [];
      const native = yield* makeAgentRunner({
        models: {
          request: (selection) => {
            model.selections.push(selection);
            const account = answering[model.selections.length - 1];
            return { ...model.request, signedAccount: () => account };
          },
        } as ModelRequester,
        idleMs: TEST_IDLE_MS,
      });
      const handle = yield* recordRun(
        native,
        sideEffectAgent(() => 'done'),
        {
          runId: 'run-accounts',
          ctx: {},
          model: {
            ownerId: 'owner-1',
            provider: 'subscription',
            model: 'claude-fable-5-1',
            reasoning: 'xhigh',
            switches: {},
          },
          messages: [Message.user('Answer.')],
          approval: { mode: 'trust', interactive: false },
          modeOf: builtinMode('trust'),
          context: projecting(
            (context) => Effect.succeed({ messages: context.messages }),
            (request) => Effect.sync(() => void observed.push(request.account)),
          ),
        },
      );
      expect(yield* handle.output.text).toBe('Answered on the second account.');
      expect(model.selections.length).toBe(2);
      expect(handle.completedSteps().map((step) => step.account)).toEqual(['k1', 'k2']);
      expect(observed).toEqual(['k1', 'k2']);
    }),
  );
});
describe('AgentRunner context boundary', () => {
  it.live(
    'catalog refresh also reaches the step after a text-only answer continued by operator words',
    Effect.fnUntraced(function* () {
      let enabled = true;
      let revision = enabled;
      let pending = true;
      let used = false;
      const agent = new Agent({
        id: 'text-switch',
        name: 'Text switch',
        description: 'Continues after operator words.',
        instructions: () => 'Answer.',
        stopWhen: [stepLimit(TEST_MAX_STEPS)],
        tools: () => {
          const tools: ToolCatalog = enabled
            ? {
                uses: Tool.make({
                  approval: ASKS_NEVER,
                  description: 'Use the capability.',
                  parameters: Schema.Struct({}),
                  display: () => ({ form: 'none' }),
                  execute: () =>
                    Effect.sync(() => {
                      used = true;
                      return 'used';
                    }),
                }),
              }
            : {};
          return tools;
        },
      });
      const model = fakeModel((number) => {
        if (number === 1) {
          enabled = false;
          return textTurn('First answer.');
        }
        return number === 2 ? toolCallTurn('uses', 'after-text') : textTurn('Finished.');
      });
      const handle = yield* runner(model).run(agent, {
        runId: 'text-switch',
        ctx: {},
        model: { ownerId: 'owner-1', provider: 'subscription', model: 'claude-opus-5', reasoning: 'xhigh', switches: {} },
        messages: [Message.user('Answer.')],
        approval: { mode: 'trust', interactive: false },
        modeOf: builtinMode('trust'),
        signals: {
          drain: (step) =>
            Effect.sync(() => {
              if (step === 0) return [];
              pending = false;
              return [{ type: 'message', text: 'Continue.', occurredAt: '' } as ThreadSignal];
            }),
          hasPending: () => Effect.succeed(pending),
        },
        refresh: (ctx) =>
          Effect.sync(() => {
            if (revision === enabled) return null;
            revision = enabled;
            return agentCatalog(agent, ctx);
          }),
      });
      expect(yield* handle.output.text).toBe('Finished.');
      expect(model.calls[1]?.toolNames.includes('uses')).toBe(false);
      expect(used).toBe(false);
    }),
  );

  it.live(
    'catalog refresh removes and restores a tool in the same context generation and the door follows it',
    Effect.fnUntraced(function* () {
      let enabled = true;
      let revision = enabled;
      let uses = 0;
      const agent = new Agent({
        id: 'switchable',
        name: 'Switchable',
        description: 'Changes its tool catalog during a run.',
        instructions: () => 'Use the tools.',
        stopWhen: [stepLimit(TEST_MAX_STEPS)],
        tools: () => ({
          switch: Tool.make({
            approval: ASKS_NEVER,
            description: 'Switch the capability.',
            parameters: Schema.Struct({}),
            display: () => ({ form: 'none' }),
            execute: () =>
              Effect.sync(() => {
                enabled = !enabled;
                return enabled;
              }),
          }),
          ...(enabled
            ? {
                uses: Tool.make({
                  approval: ASKS_NEVER,
                  description: 'Use the capability.',
                  parameters: Schema.Struct({}),
                  display: () => ({ form: 'none' }),
                  execute: () =>
                    Effect.sync(() => {
                      uses += 1;
                      return 'used';
                    }),
                }),
              }
            : {}),
        }),
      });
      const model = fakeModel((number) =>
        number === 5 ? textTurn('Finished.') : toolCallTurn(number === 1 || number === 3 ? 'switch' : 'uses', `call-${number}`),
      );
      const handle = yield* runner(model).run(agent, {
        runId: 'switchable-run',
        ctx: {},
        model: { ownerId: 'owner-1', provider: 'subscription', model: 'claude-opus-5', reasoning: 'xhigh', switches: {} },
        messages: [Message.user('Exercise the capability.')],
        approval: { mode: 'trust', interactive: false },
        modeOf: builtinMode('trust'),
        refresh: (ctx) =>
          Effect.sync(() => {
            if (revision === enabled) return null;
            revision = enabled;
            return agentCatalog(agent, ctx);
          }),
      });
      expect(yield* handle.output.text).toBe('Finished.');
      expect(model.calls.map((call) => call.toolNames.includes('uses'))).toEqual([true, false, false, true, true]);
      expect(handle.completedSteps()[1]?.content.find((part) => part.type === 'tool-result')?.result.type).toBe('error');
      expect(uses).toBe(1);
    }),
  );

  it.live(
    'a scope answered at a step boundary is what the next step runs in, inside the same run',
    Effect.fnUntraced(function* () {
      const model = fakeModel((callNumber) =>
        callNumber === 1 ? toolCallTurn('side_effect', 'call-1') : textTurn('Answered in the new context.'),
      );
      const asked: number[] = [];
      const handle = yield* runner(model).run(
        sideEffectAgent(() => 'done'),
        {
          runId: 'run-boundary',
          ctx: {},
          model: {
            ownerId: 'owner-1',
            provider: 'subscription',
            model: 'claude-opus-5',
            reasoning: 'xhigh',
            switches: {},
          },
          messages: [Message.user('Answer.')],
          approval: { mode: 'trust', interactive: false },
          modeOf: builtinMode('trust'),
          boundary: ({ stepNumber, scope }) => {
            asked.push(stepNumber);
            return Effect.succeed(
              stepNumber === 0
                ? scope
                : agentScope({
                    generation: 1,
                    ctx: {},
                    model: { ...scope.model, instructions: 'Answer from the new tree.' },
                    resolved: { catalog: { read_here: readingTool }, withheld: [] },
                  }),
            );
          },
        },
      );
      expect(yield* handle.output.text).toBe('Answered in the new context.');
      expect(asked).toEqual([0, 1]);
      expect(handle.completedSteps()).toHaveLength(2);
      expect(model.calls.map((call) => call.toolNames)).toEqual([['side_effect'], ['read_here']]);
      expect(model.selections.map((selection) => selection.instructions)).toEqual(['Run the tool once.', 'Answer from the new tree.']);
    }),
  );
  describe('a call id spent before the boundary', () => {
    const afterBoundary = Effect.fnUntraced(function* (second: ModelTurn, removed: boolean) {
      const model = fakeModel((callNumber) =>
        callNumber === 1 ? toolCallTurn('side_effect', 'call-1') : callNumber === 2 ? second : textTurn('Gave up on that id.'),
      );
      let ran = 0;
      const handle = yield* runner(model).run(
        sideEffectAgent(() => {
          ran += 1;
          return 'done';
        }),
        {
          runId: 'run-collision',
          ctx: {},
          model: { ownerId: 'owner-1', provider: 'subscription', model: 'claude-opus-5', reasoning: 'xhigh', switches: {} },
          messages: [Message.user('Answer.')],
          approval: { mode: 'trust', interactive: false },
          modeOf: builtinMode('trust'),
          boundary: ({ stepNumber, scope }) =>
            Effect.succeed(
              stepNumber === 1
                ? agentScope({
                    generation: 1,
                    ctx: {},
                    model: scope.model,
                    resolved: { catalog: removed ? {} : { side_effect: scope.catalog.side_effect! }, withheld: [] },
                  })
                : scope,
            ),
        },
      );
      expect(yield* handle.output.text).toBe('Gave up on that id.');
      const part = handle.completedSteps()[1]?.content.find((entry) => entry.type === 'tool-result');
      return { ran, result: part?.result, count: handle.runState.count('side_effect'), streak: handle.runState.streak('side_effect') };
    });
    it.live(
      'is answered with its recorded outcome after it, even where the tool was removed, and runs nothing again',
      Effect.fnUntraced(function* () {
        const replayed = yield* afterBoundary(toolCallTurn('side_effect', 'call-1'), true);
        expect(replayed.ran).toBe(1);
        expect(replayed.result?.type).not.toBe('error');
        expect(replayed.count).toBe(1);
        expect(replayed.streak).toBe(1);
      }),
    );
    it.live(
      'is refused when it returns under another name or input',
      Effect.fnUntraced(function* () {
        const reused = yield* afterBoundary(toolCallTurn('other_tool', 'call-1'), true);
        expect(reused.ran).toBe(1);
        expect(reused.result).toMatchObject({ type: 'error', value: { _tag: 'AgentToolCallReused' } });
      }),
    );
  });
  it.live(
    'a call awaiting a reader holds the boundary shut for the step that follows it',
    Effect.fnUntraced(function* () {
      const model = fakeModel((callNumber) =>
        callNumber === 1 ? toolCallTurn('confirm_me', 'call-1') : textTurn('Answered while it waits.'),
      );
      const asked: number[] = [];
      let pending = true;
      const asking = new Agent({
        id: 'asking-agent',
        name: 'Asking agent',
        description: 'Leaves one call waiting for a reader.',
        stopWhen: [stepLimit(TEST_MAX_STEPS)],
        instructions: () => 'Ask before you act.',
        tools: () => ({
          confirm_me: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_IN_REVIEW,
            description: 'Change a file.',
            parameters: Schema.Struct({}),
            execute: () => Effect.succeed('wrote it'),
            mutates: true,
            confirmation: { prompt: () => ({ summary: 'Write it?' }), confirmLabel: 'Write' },
          }),
        }),
      });
      const handle = yield* runner(model).run(asking, {
        runId: 'run-waiting',
        ctx: {},
        model: { ownerId: 'owner-1', provider: 'subscription', model: 'claude-opus-5', reasoning: 'xhigh', switches: {} },
        messages: [Message.user('Answer.')],
        signals: {
          drain: (stepNumber) =>
            Effect.sync(() => {
              if (stepNumber === 0) return [];
              pending = false;
              return [{ type: 'message', text: 'And also this.', occurredAt: '' } as ThreadSignal];
            }),
          hasPending: () => Effect.succeed(pending),
        },
        approval: { mode: 'review', interactive: true },
        modeOf: builtinMode('review'),
        boundary: ({ stepNumber, scope }) => {
          asked.push(stepNumber);
          return Effect.succeed(
            agentScope({
              generation: scope.generation + 1,
              ctx: {},
              model: scope.model,
              resolved: { catalog: scope.catalog, withheld: [] },
            }),
          );
        },
      });
      yield* handle.output.finishReason;
      expect(model.calls).toHaveLength(2);
      expect(handle.completedSteps()[0]?.toolResults).toEqual([]);
      expect(asked).toEqual([0]);
    }),
  );
  it.live(
    'a step limit counts the steps taken before the boundary as well as after it',
    Effect.fnUntraced(function* () {
      const model = fakeModel(() => toolCallTurn('side_effect', `call-${Math.random()}`));
      const limited = new Agent({
        id: 'limited-agent',
        name: 'Limited agent',
        description: 'Stops at two steps however many contexts it works in.',
        stopWhen: [stepLimit(2)],
        instructions: () => 'Run the tool.',
        tools: () => ({
          side_effect: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_NEVER,
            description: 'Run one side effect.',
            parameters: Schema.Struct({}),
            execute: () => Effect.succeed('done'),
          }),
        }),
      });
      const handle = yield* runner(model).run(limited, {
        runId: 'run-limits',
        ctx: {},
        model: { ownerId: 'owner-1', provider: 'subscription', model: 'claude-opus-5', reasoning: 'xhigh', switches: {} },
        messages: [Message.user('Answer.')],
        approval: { mode: 'trust', interactive: false },
        modeOf: builtinMode('trust'),
        boundary: ({ stepNumber, scope }) =>
          Effect.succeed(
            stepNumber === 1
              ? agentScope({ generation: 1, ctx: {}, model: scope.model, resolved: { catalog: scope.catalog, withheld: [] } })
              : scope,
          ),
      });
      yield* handle.output.finishReason;
      expect(handle.completedSteps()).toHaveLength(2);
      expect(model.calls).toHaveLength(2);
    }),
  );
});
describe('AgentRunner closing rules', () => {
  const closingInput = (runId: string) => ({
    runId,
    ctx: {},
    model: { ownerId: 'owner-1', provider: 'openai-oauth' as const, model: 'gpt-5.5', reasoning: 'high', switches: {} },
    messages: [Message.user('Change it, then say so.')],
    approval: { mode: 'trust' as const, interactive: false },
    modeOf: builtinMode('trust'),
  });
  it.live(
    'a run about to end at a text-only step takes one more step carrying its closing rule guidance',
    Effect.fnUntraced(function* () {
      const asked: number[] = [];
      const model = fakeModel((callNumber) =>
        callNumber === 1
          ? toolCallTurn('side_effect', 'call-change')
          : callNumber === 2
            ? textTurn('Changed.')
            : textTurn('The work goes on.'),
      );
      const handle = yield* runner(model).run(
        sideEffectAgent(() => 'changed'),
        {
          ...closingInput('run-closing'),
          rules: [
            agentRule(
              'closing-probe',
              (ctx) => {
                if (ctx.hook !== 'beforeClose') return null;
                asked.push(ctx.steps.length);
                const state = ctx.run.ruleState('closing-probe', () => ({ spent: false }));
                if (state.spent) return null;
                state.spent = true;
                return { type: 'guide', text: 'CLOSING-GUIDE-MARKER' };
              },
              { owner: 'test', hook: 'beforeClose', priority: 0, critical: false },
            ),
          ],
        },
      );
      expect(yield* handle.output.text).toBe('The work goes on.');
      expect(asked).toEqual([2, 3]);
      expect(model.calls).toHaveLength(3);
      expect(JSON.stringify(model.calls[1]?.messages)).not.toContain('CLOSING-GUIDE-MARKER');
      expect(JSON.stringify(model.calls[2]?.messages)).toContain('CLOSING-GUIDE-MARKER');
      expect(handle.guidance).toMatchObject([
        {
          stepNumber: 2,
          texts: ['CLOSING-GUIDE-MARKER'],
          sources: [{ hook: 'beforeClose', ruleId: 'closing-probe', state: { closing: true } }],
        },
      ]);
    }),
  );
  it.live(
    'closing rules are not called where the run would continue, where a stop condition ends it, or where the ending fails',
    Effect.fnUntraced(function* () {
      const asked: string[] = [];
      const closing = (runId: string) =>
        agentRule(
          'closing-probe',
          () => {
            asked.push(runId);
            return { type: 'guide', text: 'never shown' };
          },
          { owner: 'test', hook: 'beforeClose', priority: 0, critical: false },
        );
      const limited = new Agent({
        id: 'limited-agent',
        name: 'Limited agent',
        description: 'Stops after one step.',
        stopWhen: [stepLimit(1)],
        instructions: () => 'Run the tool.',
        tools: () => ({
          side_effect: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_NEVER,
            description: 'Change it.',
            parameters: Schema.Struct({}),
            execute: () => Effect.succeed('ok'),
          }),
        }),
      });
      const stopped = yield* runner(fakeModel(() => toolCallTurn('side_effect', 'call-stop'))).run(limited, {
        ...closingInput('run-stopped'),
        rules: [closing('run-stopped')],
      });
      yield* stopped.output.steps;
      const spent = yield* runner(fakeModel(() => textTurn('Last word.'))).run(limited, {
        ...closingInput('run-spent'),
        rules: [closing('run-spent')],
      });
      expect(yield* spent.output.text).toBe('Last word.');
      const cut = yield* runner(fakeModel(() => unfinishedTextTurn('Half an answer'))).run(agent(), {
        ...closingInput('run-cut'),
        rules: [closing('run-cut')],
      });
      yield* Effect.exit(cut.output.text);
      expect(asked).toEqual([]);
    }),
  );
  it.live('a failed noncritical closing rule leaves a typed diagnostic and does not hide the final reply', () =>
    Effect.gen(function* () {
      const recording = activityRecording();
      const model = fakeModel(() => textTurn('Closed.'));
      const handle = yield* runner(model)
        .run(agent(), {
          ...closingInput('run-closing-failed'),
          rules: [
            agentRule('closing-probe', () => Effect.fail(new Error('closing probe broke')), {
              owner: 'test',
              hook: 'beforeClose',
              priority: 0,
              critical: false,
            }),
          ],
        })
        .pipe(Effect.provideService(ActivityLog, recording.log));
      expect(yield* handle.output.text).toBe('Closed.');
      expect(model.calls).toHaveLength(1);
      expect(recording.activities().flatMap((activity) => activity.notes)).toContainEqual(
        expect.objectContaining({ type: 'rule-failed', ruleId: 'closing-probe', owner: 'test', hook: 'beforeClose' }),
      );
    }),
  );
});
const readingTool = Tool.make({
  display: () => ({ form: 'none' }),
  approval: ASKS_NEVER,
  description: 'Read what stands here.',
  parameters: Schema.Struct({}),
  execute: () => Effect.succeed('read it'),
});
function agent(): Agent<Record<string, never>> {
  return new Agent({
    id: 'test-agent',
    name: 'Test agent',
    description: 'Exercises the provider stream contract.',
    stopWhen: [stepLimit(TEST_MAX_STEPS)],
    instructions: () => 'Answer the user.',
    tools: () => ({}),
  });
}
function writingAgent(): Agent<Record<string, never>> {
  return new Agent({
    id: 'writing-agent',
    name: 'Writing agent',
    description: 'Declares a recoverable argument.',
    stopWhen: [stepLimit(TEST_MAX_STEPS)],
    instructions: () => 'Answer the user.',
    tools: () => ({
      write: Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Write a file.',
        parameters: Schema.Struct({ filePath: Schema.String, content: Schema.String }),
        recovery: { content: 'content', destination: 'filePath' },
        execute: () => Effect.succeed('written'),
      }),
    }),
  });
}
function sideEffectAgent(execute: () => string): Agent<Record<string, never>> {
  return new Agent({
    id: 'side-effect-agent',
    name: 'Side effect agent',
    description: 'Exercises output retention after a side effect.',
    stopWhen: [stepLimit(TEST_MAX_STEPS)],
    instructions: () => 'Run the tool once.',
    tools: () => ({
      side_effect: Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Run one externally visible side effect.',
        parameters: Schema.Struct({}),
        execute: () => Effect.sync(execute),
      }),
    }),
  });
}
function askingAgent(): Agent<Record<string, never>> {
  return new Agent({
    id: 'asking-agent',
    name: 'Asking agent',
    description: 'Exercises a call only a reader can answer.',
    stopWhen: [stepLimit(TEST_MAX_STEPS)],
    instructions: () => 'Ask the reader.',
    tools: () => ({
      ask_reader: Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Ask the reader one question.',
        parameters: Schema.Struct({ prompt: Schema.String }),
      }),
    }),
  });
}
function mutatingAgent(execute: () => string): Agent<Record<string, never>> {
  return new Agent({
    id: 'mutating-agent',
    name: 'Mutating agent',
    description: 'Exercises a call the rules want a reader for.',
    stopWhen: [stepLimit(TEST_MAX_STEPS)],
    instructions: () => 'Run the tool once.',
    tools: () => ({
      side_effect: Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_IN_REVIEW,
        description: 'Change one durable thing.',
        parameters: Schema.Struct({}),
        execute: () => Effect.sync(execute),
        mutates: true,
        confirmation: { prompt: () => ({ summary: 'Change it?' }), confirmLabel: 'Change' },
      }),
    }),
  });
}
function terminalToolAgent(execute: () => string): Agent<Record<string, never>> {
  return new Agent({
    id: 'terminal-tool-agent',
    name: 'Terminal tool agent',
    description: 'Stops successfully after one tool step.',
    instructions: () => 'Run the tool once.',
    tools: () => ({
      side_effect: Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Run one externally visible side effect.',
        parameters: Schema.Struct({}),
        execute: () => Effect.sync(execute),
      }),
    }),
    stopWhen: [({ steps }) => steps.length >= 1],
  });
}
type ModelTurn = {
  readonly events: readonly LLMEvent[];
  readonly paceMs?: number;
  readonly ending?: 'settles' | 'parks';
  readonly failure?: LLMError;
  readonly defect?: unknown;
  readonly drained?: () => void;
};
type ModelCallRecord = {
  readonly messages: readonly Message[];
  readonly toolNames: readonly string[];
  readonly activeTools: readonly string[] | undefined;
  readonly toolChoice: ModelStreamInput['toolChoice'];
  interrupted: boolean;
};
function callableTools(call: ModelCallRecord): string[] {
  return [...(call.activeTools ?? call.toolNames)].sort();
}
type FakeModel = {
  readonly calls: ModelCallRecord[];
  readonly selections: ModelRequestInput[];
  readonly request: ModelRequest;
};
const FAKE_ORIGIN = new ModelIdentity({ provider: ProviderID.make('openai-oauth'), model: ModelID.make('gpt-5.5') });
function fakeModel(answer: (callNumber: number) => ModelTurn, resultRetention?: ModelRequest['resultRetention']): FakeModel {
  const calls: ModelCallRecord[] = [];
  const selections: ModelRequestInput[] = [];
  const request: ModelRequest = {
    plannedOutputTokens: 32_000,
    origin: FAKE_ORIGIN,
    resultRetention: resultRetention,
    text: () => {
      throw new Error('the loop never opens a one-shot');
    },
    object: () => {
      throw new Error('the loop never opens a one-shot');
    },
    stream: (input) =>
      Stream.suspend(() => {
        const call: ModelCallRecord = {
          messages: input.messages,
          toolNames: Object.keys(input.tools),
          activeTools: input.activeTools,
          toolChoice: input.toolChoice,
          interrupted: false,
        };
        calls.push(call);
        const turn = answer(calls.length);
        const ended = Effect.sync(() => turn.drained?.()).pipe(
          Effect.flatMap(() =>
            turn.ending === 'parks'
              ? Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(() => (call.interrupted = true))))
              : turn.defect !== undefined
                ? Effect.die(turn.defect)
                : turn.failure
                  ? Effect.fail(turn.failure)
                  : Effect.void,
          ),
        );
        const paceMs = turn.paceMs;
        const events = Stream.fromIterable(turn.events);
        return (paceMs === undefined ? events : events.pipe(Stream.tap(() => Effect.sleep(paceMs)))).pipe(
          Stream.concat(Stream.fromEffect(ended).pipe(Stream.drain) as Stream.Stream<LLMEvent, LLMError>),
        );
      }),
  };
  return { calls, selections, request };
}
function runner(model: FakeModel, log?: ActivityLog) {
  return {
    run: Effect.fnUntraced(function* <TCtx>(agent: Agent<TCtx>, input: RecordedInput<TCtx>) {
      const native = yield* makeAgentRunner({
        models: {
          request: (selection) => {
            model.selections.push(selection);
            return model.request;
          },
        },
        idleMs: TEST_IDLE_MS,
      });
      const recording = recordRun(native, agent, input);
      return yield* log === undefined ? recording : recording.pipe(Effect.provideService(ActivityLog, log));
    }),
  };
}
function firstMediaData(messages: readonly Message[]): unknown {
  for (const message of messages) {
    for (const part of message.content) {
      if (part.type === 'media') return part.data;
    }
  }
  return undefined;
}
function projecting(project: AgentContext['project'], observe?: AgentContext['observe']): AgentContext {
  return {
    project,
    lower: (messages) => Effect.succeed(messages),
    observe: observe ?? (() => Effect.succeed(undefined)),
  };
}
const TEST_IDLE_MS = 30_000;
const TEST_MAX_STEPS = 20;
const USAGE = new Usage({
  inputTokens: 100,
  nonCachedInputTokens: 100,
  cacheReadInputTokens: 0,
  cacheWriteInputTokens: 0,
  outputTokens: 10,
  reasoningTokens: 0,
  totalTokens: 110,
});
function finished(reason: FinishReason): LLMEvent {
  return { type: 'finish', reason, usage: USAGE };
}
function textEvents(text: string, id = 'text-1'): LLMEvent[] {
  return [
    { type: 'step-start', index: 0 },
    { type: 'text-start', id },
    { type: 'text-delta', id, text },
    { type: 'text-end', id },
    { type: 'step-finish', index: 0, reason: 'stop' },
  ];
}
function toolEvents(toolName: string, toolCallId: string, input: unknown): LLMEvent[] {
  return [
    { type: 'tool-input-start', id: toolCallId, name: toolName },
    { type: 'tool-call', id: toolCallId, name: toolName, input },
  ];
}
function textTurn(text: string): ModelTurn {
  return finishedTextTurn(text, 'stop');
}
function finishedTextTurn(text: string, finishReason: FinishReason): ModelTurn {
  return { events: [...textEvents(text), finished(finishReason)] };
}
function unfinishedTextTurn(text: string): ModelTurn {
  return finishedTextTurn(text, 'unknown');
}
function failedTextTurn(text: string, failure: LLMError): ModelTurn {
  return {
    events: [
      { type: 'step-start', index: 0 },
      { type: 'text-start', id: 'text-1' },
      { type: 'text-delta', id: 'text-1', text },
    ],
    failure,
  };
}
function toolCallTurn(toolName: string, toolCallId: string, input: unknown = {}): ModelTurn {
  return {
    events: [
      { type: 'step-start', index: 0 },
      ...toolEvents(toolName, toolCallId, input),
      { type: 'step-finish', index: 0, reason: 'tool-calls' },
      finished('tool-calls'),
    ],
  };
}
function parallelToolCallTurn(
  calls: readonly {
    readonly name: string;
    readonly id: string;
    readonly input: unknown;
  }[],
): ModelTurn {
  return {
    events: [
      { type: 'step-start', index: 0 },
      ...calls.flatMap((call) => toolEvents(call.name, call.id, call.input)),
      { type: 'step-finish', index: 0, reason: 'tool-calls' },
      finished('tool-calls'),
    ],
  };
}
function invalidToolCallTurn(toolName: string, toolCallId: string, input: unknown): ModelTurn {
  return toolCallTurn(toolName, toolCallId, input);
}
function textThenToolTurn(text: string, toolName: string, toolCallId: string, input: unknown = {}): ModelTurn {
  return {
    events: [
      { type: 'step-start', index: 0 },
      { type: 'text-start', id: `text-${toolCallId}` },
      { type: 'text-delta', id: `text-${toolCallId}`, text },
      { type: 'text-end', id: `text-${toolCallId}` },
      ...toolEvents(toolName, toolCallId, input),
      { type: 'step-finish', index: 0, reason: 'tool-calls' },
      finished('tool-calls'),
    ],
  };
}
function emptyFinishTurn(): ModelTurn {
  return {
    events: [{ type: 'step-start', index: 0 }, { type: 'step-finish', index: 0, reason: 'stop' }, finished('stop')],
  };
}
function parkedTurn(drained: () => void): ModelTurn {
  return { events: [{ type: 'step-start', index: 0 }], ending: 'parks', drained };
}
function brokenTurn(defect: unknown): ModelTurn {
  return { events: [{ type: 'step-start', index: 0 }], defect };
}
function doorFailure(cause: unknown, reason: LLMError['reason'] = providerReason(cause)): LLMError {
  return new LLMError({ module: 'Provider', method: 'stream', reason });
}
function providerReason(cause: unknown) {
  return new UnknownProviderReason({
    message: cause instanceof Error ? cause.message : String(cause),
    status: 500,
  });
}
function tornStream(message = 'The socket connection was closed unexpectedly'): LLMError {
  return new LLMError({
    module: 'Provider',
    method: 'stream',
    reason: new InvalidProviderOutputReason({ message, family: 'torn-stream', status: 200, attempt: 0 }),
  });
}
function rateLimited(retryAfterMs: number): LLMError {
  return new LLMError({
    module: 'Provider',
    method: 'stream',
    reason: new RateLimitReason({ message: 'Slow down.', retryAfterMs }),
  });
}
function contextOverflow(): LLMError {
  return new LLMError({
    module: 'Provider',
    method: 'stream',
    reason: new InvalidRequestReason({
      message: 'Input exceeds the context window.',
      classification: 'context-overflow',
    }),
  });
}
function contextOverflowTurn(failure: LLMError = contextOverflow()): ModelTurn {
  return { events: [], failure };
}
const streamCause = (handle: RecordedRun) =>
  handle.output.steps.pipe(Effect.match({ onSuccess: () => null, onFailure: (broke) => broke.cause }));
const until = Effect.fnUntraced(function* (ready: () => boolean) {
  while (!ready()) yield* Effect.sleep('5 millis');
});
