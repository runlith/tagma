import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Stream } from 'effect';
import { Agent } from '../../agent/Agent';
import { makeAgentRunner } from '../../agent/AgentRunner';
import { RunStop } from '../../agent/RunStop';
import type { AgentEvent } from '../../agent/AgentEvent';
import type { ModelRequest } from '../../agent/modelPort';
import { builtinMode } from '../../agent/testing/modes';
import { Message } from '@runlith/llm/schema/messages';
import { Usage, type LLMEvent } from '@runlith/llm/schema/events';
import { threadUserQuestionTools, userQuestionFromToolCall } from '../../tools/UserQuestion';
import { READY_ANSWERS_TOOL, threadReadyAnswerTools } from '../../tools/ReadyAnswers';
import { makeThreadStreamSink } from '../run/ThreadStreamSink';
import { THREAD_QUESTION_PART, THREAD_READY_ANSWERS_PART } from '../../transcript/parts';
import { openMemoryStorage } from './memoryStorage';
import { OWNER, SCOPE, scriptedWorld, startedTurn } from './runLog/world';
import { dyingToolTurn, reportTurn } from './runLog/toolScripts';
import { until } from './runLog/support';
const usage = new Usage({
  inputTokens: 1,
  outputTokens: 1,
  totalTokens: 2,
  reasoningTokens: 0,
  cacheReadInputTokens: 0,
  cacheWriteInputTokens: 0,
  nonCachedInputTokens: 1,
});
const cases = [
  ['ask_user', { questions: [] }, ['questions'], true],
  [READY_ANSWERS_TOOL, { answers: [] }, ['answers'], true],
  ['ask_user', { questions: [{ prompt: 42 }] }, ['questions[0].prompt', '42'], true],
  [
    READY_ANSWERS_TOOL,
    {
      answers: [
        { label: 'A', send: 'A' },
        { label: 'B', send: 42 },
      ],
    },
    ['answers[1].send', '42'],
    true,
  ],
  [
    'ask_user',
    {
      answers: [
        { label: 'A', send: 'A' },
        { label: 'B', send: 'B' },
      ],
    },
    [READY_ANSWERS_TOOL],
    true,
  ],
  ['ask_user', { questions: [] }, ['questions'], false],
] as const;

const expectRefusedNaming = (result: unknown, named: readonly string[]) => {
  const naming = named.map((one) => `(?=[^]*${one.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')})`).join('');
  expect(result).toMatchObject({ type: 'text', value: expect.stringMatching(new RegExp(`^refused\\[body-shape\\]: ${naming}`, 'u')) });
};
it.live.each(cases)(
  'a native run answers invalid %s input and the model continues',
  Effect.fnUntraced(function* (name, input, named, interactive = true) {
    let requests = 0;
    let next: readonly Message[] = [];
    const model: ModelRequest = {
      plannedOutputTokens: 32,
      text: () => Effect.die(new Error('This run streams.')),
      object: () => Effect.die(new Error('This run streams.')),
      stream: (asked) =>
        Stream.suspend(() => {
          requests += 1;
          if (requests === 1)
            return Stream.fromIterable<LLMEvent>([
              { type: 'step-start', index: 0 },
              { type: 'tool-input-start', id: 'invalid', name },
              { type: 'tool-call', id: 'invalid', name, input },
              { type: 'step-finish', index: 0, reason: 'tool-calls' },
              { type: 'finish', reason: 'tool-calls', usage },
            ]);
          next = asked.messages;
          return Stream.fromIterable<LLMEvent>([
            { type: 'step-start', index: 0 },
            { type: 'text-start', id: 'reply' },
            { type: 'text-delta', id: 'reply', text: 'Continuing after the refusal.' },
            { type: 'text-end', id: 'reply' },
            { type: 'step-finish', index: 0, reason: 'stop' },
            { type: 'finish', reason: 'stop', usage },
          ]);
        }),
    };
    const runner = yield* makeAgentRunner({ models: { request: () => model }, idleMs: 30_000 });
    const agent = new Agent({
      id: 'question-input',
      name: 'Question input',
      description: 'Exercise input refusal.',
      instructions: () => '',
      tools: () => ({ ...threadUserQuestionTools, ...threadReadyAnswerTools }),
      stopWhen: [],
    });
    const events: AgentEvent[] = [];
    const sink = makeThreadStreamSink({
      runId: 'run',
      record: (event) =>
        Effect.sync(() => {
          events.push(event);
        }),
      questionForTool: userQuestionFromToolCall,
    });
    const run = yield* runner.run(
      agent,
      {
        runId: 'run',
        stop: new RunStop(),
        ctx: {},
        messages: [Message.user('Continue after an invalid call.')],
        model: { ownerId: 'owner', provider: 'test', model: null, reasoning: null, switches: {} },
        approval: { mode: 'trust', interactive },
        modeOf: builtinMode('trust'),
      },
      sink,
    );
    expect(yield* run.output.text).toBe('Continuing after the refusal.');
    const results = next.flatMap((message) => message.content.filter((part) => part.type === 'tool-result'));
    expect(results).toMatchObject([{ id: 'invalid', name }]);
    expectRefusedNaming(results[0]?.result, named);
    expect(events.filter((event) => event.type === 'tool-outcome')).toMatchObject([
      { toolCallId: 'invalid', outcome: { kind: 'refused', refusal: { code: 'body-shape' } } },
    ]);
    expect(
      events.filter((event) => event.type === `data-${THREAD_QUESTION_PART}` || event.type === `data-${THREAD_READY_ANSWERS_PART}`),
    ).toEqual([]);
    expect(yield* run.output.finishReason).toBe('stop');
  }),
);
it.effect(
  'ready answers remain visible when the call carries its door-owned background field',
  Effect.fnUntraced(function* () {
    const events: AgentEvent[] = [];
    const sink = makeThreadStreamSink({
      runId: 'run',
      record: (event) =>
        Effect.sync(() => {
          events.push(event);
        }),
      questionForTool: userQuestionFromToolCall,
    });
    const answers = [
      { label: 'A', send: 'Choose A' },
      { label: 'B', send: 'Choose B' },
    ];
    yield* sink.push({ type: 'tool-call', id: 'ready', name: READY_ANSWERS_TOOL, input: { answers, background: false } });
    expect(events.filter((event) => event.type === `data-${THREAD_READY_ANSWERS_PART}`)).toMatchObject([
      { data: { type: 'ready-answers', answers } },
    ]);
  }),
);
it.live.each(cases.slice(0, 2))(
  'adoption answers the recorded invalid %s call before resuming the model',
  Effect.fnUntraced(function* (name, input, named, _interactive) {
    const storage = yield* Effect.acquireRelease(openMemoryStorage(), (storage) => storage.dispose());
    const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
    const catalog = { ...threadUserQuestionTools, ...threadReadyAnswerTools };
    const prior = yield* scriptedWorld(storage, thread.agentId, { catalog });
    const next = yield* scriptedWorld(storage, thread.agentId, { catalog });
    prior.plan.push(dyingToolTurn(name, input));
    const run = yield* startedTurn(prior, thread.id, 'Recover the input refusal.');
    yield* until(() =>
      Effect.map(
        storage.aggregate.find(thread.id),
        (row) => row?.history.some((message) => message.content.some((part) => part.type === 'tool-call' && part.id === 'call-1')) ?? false,
      ),
    );
    yield* prior.dispose();
    next.plan.push(reportTurn());
    expect(yield* next.harness.runs.recoverNow()).toBe(1);
    yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.status === 'idle'));
    const replayed = next.replayed[0]?.flatMap((message) => message.content.filter((part) => part.type === 'tool-result')) ?? [];
    expect(replayed).toMatchObject([{ id: 'call-1' }]);
    expectRefusedNaming(replayed[0]?.result, named);
    expect((yield* storage.aggregate.transcriptOf(thread.id))?.filter((entry) => entry.type === 'tool')).toMatchObject([
      { toolCallId: 'call-1', toolState: 'output-refused', toolRefusal: { code: 'body-shape' } },
    ]);
    expect(yield* storage.runs({ ownerId: 'observer', scope: SCOPE }).latestRun(thread.id)).toMatchObject({
      id: run.runId,
      status: 'completed',
    });
  }),
);
