import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect, Stream } from 'effect';
import { LLMResponse, Usage } from '@runlith/llm/schema/events';
import { Message, ToolCallPart } from '@runlith/llm/schema/messages';
import { makeThreadSummaryStrategy } from '../compaction/summaryStrategy';
import type { ModelRequest } from '../../agent/modelPort';
import { projectToolResultMessages } from '../../agent/ToolOutput';
import type { ThreadCompactionStorage } from '../storage/compaction';
import { lookupModels } from '../compaction/lookupModels';
import type { ThreadCompactionPolicy } from '../compaction/policy';
import { makeThreadDigestStrategy } from '../compaction/digestStrategy';
import { ThreadRequestMeter } from '../compaction/ThreadRequestMeter';
import type { ThreadCompactionText } from '../compaction/text';
import { ThreadAttachments } from '../ThreadPorts';
import { makeThreadCompaction, ThreadCompactor } from './ThreadCompaction';
import { ThreadCompactionRuns } from './ThreadCompactionRuns';
import { makeThreadContextAnchors } from './ThreadContextAnchor';

const policy: ThreadCompactionPolicy = {
  compactionTrigger: { strategy: 'reserve-output' },
  compactionOverrides: [],
  bufferTokens: 20_000,
  imageTokens: 0,
  maxRecentTokens: 8_000,
  minRecentTokens: 2_000,
  maxOpeningTokens: 8_000,
  recentFraction: 0.25,
  recentUserTurns: 2,
  toolPruneProtectShare: 0.2,
};
const text: ThreadCompactionText = {
  checkpointMarker: 'Continue from the anchored thread state below.',
  prunedToolOutput: '[Old tool result content cleared]',
  overflowMediaGuidance: 'Attached media was omitted from this retry.',
  omittedMedia: (mediaType) => `[Attached ${mediaType ?? 'media'} omitted.]`,
};
const uncallable: ModelRequest = {
  plannedOutputTokens: 32_000,
  stream: () => Stream.die(new Error('a normal step calls no model')),
  text: () => Effect.die(new Error('a normal step calls no model')),
  object: () => Effect.die(new Error('a normal step calls no model')),
};
const TURNS = 600;
const CLEARED = 300;

const turn = (at: number): readonly Message[] => [
  Message.user(`Read file ${at}.`),
  Message.assistant([ToolCallPart.from({ id: `call-${at}`, name: 'read', input: { at } })]),
  Message.make({
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        id: `call-${at}`,
        name: 'read',
        result: { type: 'text', value: at < CLEARED ? text.prunedToolOutput : `body ${at}` },
      },
    ],
  }),
];

const watchedHistory = () => {
  const watch = { reads: 0 };
  const counted = <T extends object>(value: T): T =>
    new Proxy(value, {
      get: (target, key) => {
        watch.reads += 1;
        return Reflect.get(target, key);
      },
    });
  const watched = (message: Message): Message =>
    counted(
      message.role !== 'tool'
        ? message
        : ({
            ...message,
            content: message.content.map((part) => (part.type === 'tool-result' ? { ...part, result: counted(part.result) } : part)),
          } as Message),
    );
  const measured = Array.from({ length: TURNS }, (_, at) => turn(at))
    .flat()
    .map(watched);
  return { watch, measured };
};

const decided = new Set(Array.from({ length: CLEARED }, (_, at) => `call-${at}`));
const settlesNothing = () => Effect.die(new Error('a normal step settles nothing'));
const compactionOwner = () =>
  makeThreadCompaction({
    models: lookupModels({ request: () => uncallable, capacity: () => ({ context: 200_000, output: 32_000 }) }),
    policy: () => Effect.succeed(policy),
    strategy: makeThreadDigestStrategy(),
    recovery: makeThreadDigestStrategy(),
    text,
    checkpoints: {
      latestCheckpoint: () => Effect.succeed(null),
      prunedToolCalls: () => Effect.succeed(decided),
      prunedToolCallVolume: () => Effect.succeed({ count: CLEARED, tokens: 0 }),
      compactionCount: () => Effect.succeed(0),
      markToolCallsPrunedIn: settlesNothing,
      retirePrunedToolCallsIn: settlesNothing,
      writeCheckpointIn: settlesNothing,
    } satisfies ThreadCompactionStorage,
  });

it.effect('a compaction serializes each message of the history it folds once and never stringifies the whole history', () =>
  Effect.gen(function* () {
    const reads = { content: 0, json: 0 };
    const watched = (message: Message): Message =>
      new Proxy(message, {
        get: (target, key) => {
          if (key === 'content') reads.content += 1;
          if (key === 'toJSON') reads.json += 1;
          return Reflect.get(target, key);
        },
      });
    const summary = `## State\n${'The thread read many files and kept its plan. '.repeat(80)}`;
    const summarizer: ModelRequest = {
      ...uncallable,
      text: () =>
        Effect.succeed(
          new LLMResponse({
            message: Message.assistant(summary),
            events: [{ type: 'text-delta', id: 'summary', text: summary }],
            usage: new Usage({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }),
            finishReason: 'stop',
          }),
        ),
    };
    const models = lookupModels({ request: () => summarizer, capacity: () => ({ context: 200_000, output: 32_000 }) });
    const compaction = makeThreadCompaction({
      models,
      policy: () => Effect.succeed(policy),
      strategy: makeThreadSummaryStrategy({ models, prompt: { instructions: 'Summarize.', template: '## State' } }),
      recovery: makeThreadDigestStrategy(),
      text,
      checkpoints: {
        latestCheckpoint: () => Effect.succeed(null),
        prunedToolCalls: () => Effect.succeed(decided),
        prunedToolCallVolume: () => Effect.succeed({ count: CLEARED, tokens: 0 }),
        compactionCount: () => Effect.succeed(0),
        markToolCallsPrunedIn: settlesNothing,
        retirePrunedToolCallsIn: settlesNothing,
        writeCheckpointIn: settlesNothing,
      } satisfies ThreadCompactionStorage,
    });
    const history = Array.from({ length: TURNS }, (_, at) => turn(at))
      .flat()
      .map(watched);
    const meter = compaction.meter();
    const input = {
      threadId: 'thread-1',
      runId: 'run-1',
      stepNumber: 1,
      ownerId: 'owner-1',
      provider: 'openai-oauth',
      model: 'gpt-5.6-sol',
      reasoning: null,
      switches: {},
      history,
      tools: [],
      plannedOutputTokens: 32_000,
      overflow: false,
      meter,
      measuredRequest: null,
    };
    yield* compaction.prepare(input);
    reads.content = 0;
    reads.json = 0;
    const folded = yield* compaction.prepare({ ...input, requested: { summarizing: { kind: 'own', reason: 'named' } } });
    expect(folded.compacted).toBe(true);
    expect(folded.settlement?.covers(history)).toBe(true);
    expect(reads.json).toBeLessThan(history.length);
    expect(reads.content).toBeLessThan(3 * history.length);
  }),
);

it.effect('a run budget caps the request: a history over it is brought under it before the step, as the model window would', () =>
  Effect.gen(function* () {
    const BUDGET = 60_000;
    const read = (at: number): readonly Message[] => [
      Message.user(`Read part ${at}.`),
      Message.assistant([ToolCallPart.from({ id: `part-${at}`, name: 'read', input: { at } })]),
      Message.make({
        role: 'tool',
        content: [{ type: 'tool-result', id: `part-${at}`, name: 'read', result: { type: 'text', value: `line ${at} `.repeat(800) } }],
      }),
    ];
    const history = Array.from({ length: 40 }, (_, at) => read(at)).flat();
    const stepUnder = (given: ThreadCompactionPolicy) =>
      makeThreadCompaction({
        models: lookupModels({ request: () => uncallable, capacity: () => ({ context: 200_000, output: 32_000 }) }),
        policy: () => Effect.succeed(given),
        strategy: makeThreadDigestStrategy(),
        recovery: makeThreadDigestStrategy(),
        text,
        checkpoints: {
          latestCheckpoint: () => Effect.succeed(null),
          prunedToolCalls: () => Effect.succeed(new Set<string>()),
          prunedToolCallVolume: () => Effect.succeed({ count: 0, tokens: 0 }),
          compactionCount: () => Effect.succeed(0),
          markToolCallsPrunedIn: settlesNothing,
          retirePrunedToolCallsIn: settlesNothing,
          writeCheckpointIn: settlesNothing,
        } satisfies ThreadCompactionStorage,
      }).prepare({
        threadId: 'thread-1',
        runId: 'run-1',
        stepNumber: 1,
        ownerId: 'owner-1',
        provider: 'openai-oauth',
        model: 'gpt-5.6-sol',
        reasoning: null,
        switches: {},
        history,
        tools: [],
        plannedOutputTokens: 32_000,
        overflow: false,
        meter: new ThreadRequestMeter(),
        measuredRequest: null,
      });

    expect((yield* stepUnder(policy)).correctedTokens).toBeGreaterThan(BUDGET);
    expect((yield* stepUnder({ ...policy, runBudget: { prompt: BUDGET } })).correctedTokens).toBeLessThanOrEqual(BUDGET);
  }),
);

it.effect('a normal model step reads no message or tool result of the history the thread already measured', () =>
  Effect.gen(function* () {
    const { watch, measured } = watchedHistory();
    const compaction = compactionOwner();
    const footprint = (yield* new ThreadRequestMeter().requestHashed(
      { system: undefined, messages: measured, tools: [], providerOptions: undefined },
      policy.imageTokens,
    )).footprint;
    const meter = new ThreadRequestMeter();
    const step = (history: readonly Message[]) =>
      compaction.prepare({
        threadId: 'thread-1',
        runId: 'run-1',
        stepNumber: 1,
        ownerId: 'owner-1',
        provider: 'openai-oauth',
        model: 'gpt-5.6-sol',
        reasoning: null,
        switches: {},
        history,
        tools: [],
        plannedOutputTokens: 32_000,
        overflow: false,
        meter,
        measuredRequest: { inputTokens: 40_000, cachedInputTokens: 30_000, provider: 'openai-oauth', model: 'gpt-5.6-sol', footprint },
      });
    const first = yield* step(measured);
    expect(first).toMatchObject({ compacted: false, settlement: undefined });
    watch.reads = 0;
    const next = yield* step([...measured, ...turn(TURNS)]);
    expect(watch.reads).toBe(0);
    expect(next).toMatchObject({ compacted: false, settlement: undefined, basis: 'measured' });
  }),
);

it.effect('the request of a later step lowers only the messages the run has not sent before, whatever answer was lowered between', () =>
  Effect.gen(function* () {
    const { watch, measured } = watchedHistory();
    const unexpected = (): never => {
      throw new Error('not part of lowering');
    };
    const make = yield* Effect.provide(
      makeThreadContextAnchors,
      Context.make(ThreadCompactor, compactionOwner()).pipe(
        Context.add(ThreadCompactionRuns, {
          opening: unexpected,
          work: unexpected,
          recordEntry: unexpected,
          settle: unexpected,
          foldPruning: unexpected,
        }),
        Context.add(ThreadAttachments, {
          keep: unexpected,
          resolve: unexpected,
          addressed: unexpected,
          hydrate: (_, messages) => Effect.sync(() => messages.map((message) => Message.make({ ...message }))),
          sizes: () => Effect.succeed(new Map()),
        }),
      ),
    );
    const anchor = make({
      thread: { id: 'thread-1', cacheGroup: 'cache-1', contextReading: null },
      runId: 'run-1',
      model: { ownerId: 'owner-1', provider: 'openai-oauth', model: 'gpt-5.6-sol', reasoning: null, switches: {} },
      outputScope: {
        tools: {},
        project: unexpected,
        projectMessages: (messages) =>
          projectToolResultMessages(messages, (input) => Effect.succeed({ output: input.output, modelOutput: input.modelOutput })),
        retainInterrupted: unexpected,
        retainOpen: unexpected,
        commitReferenced: unexpected,
        dispose: unexpected,
      },
      history: Effect.succeed(measured),
    });
    const first = yield* anchor.lower(measured);
    const tail = turn(TURNS);
    yield* anchor.lower(tail.slice(1));
    watch.reads = 0;
    const next = yield* anchor.lower([...measured, ...tail]);
    expect(watch.reads).toBe(0);
    expect(next.length).toBe(measured.length + tail.length);
    expect(next.slice(0, first.length).every((message, at) => message === first[at])).toBe(true);
  }),
);
