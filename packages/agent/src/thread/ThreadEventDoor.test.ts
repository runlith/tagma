import { it } from '@runlith/effect-test';
import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import type { ThreadCompactionEntry, ThreadMessageEntry } from '../transcript/entries';
import type { ThreadEventInsert, ThreadEventLogStorage, ThreadEventRow } from './storage/eventLog';
import { threadPromise as tp } from './conformance/border';
import { appendThreadEventsIn, foldThreadEvent, foldThreadEvents, sealThreadEvents } from './ThreadEventDoor';
import { type ThreadTx } from './ThreadPorts';
import {
  threadCompactionEvent,
  threadEntryEvent,
  threadMeasurementEvent,
  threadSignalEvent,
  threadSpokenMessageEvent,
  threadStepMessagesEvent,
  threadSystemPromptEvent,
  type ThreadEventBody,
} from './events';
import { Message } from '@runlith/llm/schema/messages';
import { Usage } from '@runlith/llm/schema/events';
import type { ThreadSignal } from '../transcript/parts';
import type { ThreadRunRow } from './rows';
import { makeThreadEntryReader } from '../transcript/kinds';
const run = { id: 'run-1', updatedAt: new Date('2026-08-17T10:00:00Z') } as ThreadRunRow;
function signal(text: string): ThreadSignal {
  return { id: `sig-${text}`, type: 'user-message', addressee: 'reader', text, occurredAt: '2026-08-17T10:00:00.000Z' };
}
const empty = {
  history: [],
  transcript: [],
  contextReading: null,
  placements: [],
  cacheObservations: [],
  covered: null,
} as const;
function journal(inserts: ThreadEventInsert[]): ThreadEventLogStorage<ThreadTx> {
  return {
    append: (event) =>
      Effect.sync(() => {
        inserts.push(event);
        return { ...event, position: inserts.length } as ThreadEventRow;
      }),
    eventsAfter: () => Effect.succeed([]),
    recordsAsOf: () => Effect.succeed([]),
    revisionsAsOf: () => Effect.succeed([]),
    positionOf: () => Effect.succeed(null),
    headPosition: () => Effect.sync(() => inserts.length),
  };
}
describe('a compaction entry carries its decision', () => {
  test('the receipt survives the fold that records the compaction', () => {
    const entry: ThreadCompactionEntry = {
      type: 'compaction',
      id: 'compaction:run-1:0',
      runId: 'run-1',
      mode: 'automatic',
      status: 'completed',
      occurredAt: '2026-08-17T10:00:00.000Z',
      receipt: {
        cause: 'projected',
        projectedTokens: 365_000,
        usableTokens: 352_000,
        measuredTokens: 156_020,
        contextWindow: 872_000,
        inputLimit: 744_000,
      },
    };
    const folded = foldThreadEvent(empty, threadCompactionEvent(entry));
    const recorded = folded.transcript.find((item) => item.type === 'compaction') as ThreadCompactionEntry | undefined;
    expect(recorded?.receipt?.cause).toBe('projected');
    expect(recorded?.receipt?.projectedTokens).toBe(365_000);
    expect(recorded?.receipt?.usableTokens).toBe(352_000);
    expect(recorded?.receipt?.measuredTokens).toBe(156_020);
  });
});
describe('foldThreadEvent', () => {
  test('reader input positions belong to the folded source revision and survive a later revision of the same input', () => {
    const first = foldThreadEvents(empty, [threadSignalEvent(signal('first'), run.id)], 10);
    const second = foldThreadEvents(first, [threadSignalEvent({ ...signal('revised'), id: signal('first').id }, run.id)], 11);
    expect(first.history[0]?.metadata).toMatchObject({ readerInput: 'sig-first', readerPosition: 11 });
    expect(second.history.at(-1)?.metadata).toMatchObject({ readerInput: 'sig-first', readerPosition: 12 });
    expect(first.history[0]?.metadata).toMatchObject({ readerPosition: 11 });
  });
  test('a batch updates run membership before withdrawal, rewind and restore without changing the seed', () => {
    const first: ThreadMessageEntry = {
      type: 'message',
      id: 'first',
      role: 'assistant',
      runId: 'left',
      text: 'first',
      occurredAt: '2026-08-17T10:00:00.000Z',
    };
    const second: ThreadMessageEntry = { ...first, id: 'second', runId: 'right', text: 'second' };
    const moved: ThreadMessageEntry = { ...first, runId: 'right', text: 'moved' };
    const seed = { ...empty, transcript: [first, second] };
    const events: ThreadEventBody[] = [
      threadEntryEvent(moved),
      { kind: 'withdrawal', payload: { withdrawn: { runId: 'left', keepMessages: 0 } } },
      { kind: 'rewind', payload: { rewound: { id: 'rewind', scope: 'turn', runIds: ['right'], cuts: [] } } },
      { kind: 'restore', payload: { restored: { rewindId: 'rewind', runIds: ['right'], inserts: [] } } },
    ];
    const folded = foldThreadEvents(seed, events);
    expect(folded.transcript).toEqual([moved, second]);
    expect(folded.placements.map((placement) => placement.kind)).toEqual(['replace', 'mark', 'mark']);
    expect(seed.transcript).toEqual([first, second]);
  });
  test('a signal advances both folds: the entry appends, the message joins history', () => {
    const folded = foldThreadEvent(empty, threadSignalEvent(signal('check the build'), run.id));
    expect(folded.transcript).toHaveLength(1);
    expect(folded.transcript[0]).toMatchObject({ type: 'signal', id: 'transcript:signal:sig-check the build' });
    expect(folded.history).toHaveLength(1);
  });
  test('a system prompt lands ahead of everything already materialized', () => {
    const withSignal = foldThreadEvent(empty, threadSignalEvent(signal('first'), run.id));
    const folded = foldThreadEvent(withSignal, threadSystemPromptEvent(run.id, 'You are the agent.'));
    expect(folded.transcript.map((entry) => entry.type)).toEqual(['system-prompt', 'signal']);
  });
  test('a compaction transitions in place under its id and keeps the moment it started', () => {
    const running: ThreadCompactionEntry = {
      type: 'compaction',
      id: 'compaction:run-1',
      runId: 'run-1',
      mode: 'manual',
      status: 'running',
      occurredAt: '2026-08-17T10:00:00.000Z',
    };
    const started = foldThreadEvent(empty, threadCompactionEvent(running));
    const settled = foldThreadEvent(
      started,
      threadCompactionEvent({ ...running, status: 'completed', occurredAt: '2026-08-17T10:05:00.000Z' }),
    );
    expect(settled.transcript).toHaveLength(1);
    expect(settled.transcript[0]).toMatchObject({ status: 'completed', occurredAt: '2026-08-17T10:00:00.000Z' });
  });
  test('a settled compaction replaces the covered prefix and keeps the tail after it', () => {
    const settled: ThreadCompactionEntry = {
      type: 'compaction',
      id: 'compaction:run-1',
      runId: 'run-1',
      mode: 'automatic',
      status: 'completed',
      occurredAt: '2026-08-17T10:05:00.000Z',
    };
    const before = {
      ...empty,
      history: [Message.user('one'), Message.assistant('two'), Message.user('three'), Message.assistant('four')],
    };
    const folded = foldThreadEvent(
      before,
      threadCompactionEvent(settled, {
        keepFrom: 2,
        messages: [Message.user('[history folded]'), Message.assistant('a summary of one and two')],
      }),
    );
    expect(folded.history).toHaveLength(4);
    expect(folded.history[0]).toMatchObject({ role: 'user' });
    expect(folded.history[1]).toMatchObject({ role: 'assistant' });
    expect(folded.history.slice(2)).toEqual(before.history.slice(2));
    const step = threadStepMessagesEvent([Message.assistant('five')]);
    if (step === null) throw new Error('a step carrying a message is never null');
    const grown = foldThreadEvent(folded, step);
    expect(grown.history).toHaveLength(5);
  });
  test('a compaction that settled nothing leaves the history exactly as it stood', () => {
    const before = { ...empty, history: [Message.user('one'), Message.assistant('two')] };
    const folded = foldThreadEvent(
      before,
      threadCompactionEvent({
        type: 'compaction',
        id: 'compaction:run-1',
        runId: 'run-1',
        mode: 'automatic',
        status: 'running',
        occurredAt: '2026-08-17T10:00:00.000Z',
      }),
    );
    expect(folded.history).toEqual(before.history);
  });
  test('a billed step replaces the reading whole; a completed compaction stales it; the next bill is fresh', () => {
    const bill = (stepNumber: number, inputTokens: number) => ({
      usage: new Usage({ inputTokens, outputTokens: 10, totalTokens: inputTokens + 10 }),
      context: {
        runId: run.id,
        stepNumber,
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        contextWindow: 200_000,
        measuredAt: `2026-08-17T10:0${stepNumber}:00.000Z`,
      },
    });
    const first = foldThreadEvent(empty, threadStepMessagesEvent([Message.assistant('one')], bill(0, 1_000))!);
    expect(first.contextReading).toEqual({
      ...bill(0, 1_000).context,
      inputLimit: null,
      usage: bill(0, 1_000).usage,
      stale: false,
    });
    expect(first.contextReading?.footprint).toBeUndefined();
    const unbilled = foldThreadEvent(first, threadStepMessagesEvent([Message.assistant('two')])!);
    expect(unbilled.contextReading).toBe(first.contextReading);
    const running: ThreadCompactionEntry = {
      type: 'compaction',
      id: 'compaction:run-1',
      runId: 'run-1',
      mode: 'automatic',
      status: 'running',
      occurredAt: '2026-08-17T10:02:00.000Z',
    };
    const compacting = foldThreadEvent(unbilled, threadCompactionEvent(running));
    expect(compacting.contextReading?.stale).toBe(false);
    const compacted = foldThreadEvent(compacting, threadCompactionEvent({ ...running, status: 'completed' }));
    expect(compacted.contextReading).toEqual({ ...first.contextReading!, stale: true });
    const next = foldThreadEvent(compacted, threadStepMessagesEvent([], bill(3, 400))!);
    expect(next.contextReading).toMatchObject({ stepNumber: 3, stale: false, usage: { inputTokens: 400 } });
  });
  test('a call measurement replaces the reading, and the step bill behind it may not take it back', () => {
    const measurement = {
      runId: run.id,
      stepNumber: 0,
      attempt: 0,
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      usage: new Usage({ inputTokens: 120_000, outputTokens: 900, totalTokens: 120_900 }),
      contextWindow: 200_000,
      inputLimit: 180_000,
      footprint: { messages: 12, messageDigest: 'm', promptDigest: 'p', toolDigests: ['t'] },
      measuredAt: '2026-08-17T10:00:00.000Z',
    };
    const measured = foldThreadEvent(empty, threadMeasurementEvent(measurement));
    expect(measured.contextReading).toMatchObject({
      usage: measurement.usage,
      footprint: measurement.footprint,
      attempt: 0,
      inputLimit: 180_000,
      stale: false,
    });
    expect(measured.history).toEqual(empty.history);
    expect(measured.transcript).toEqual(empty.transcript);
    const late = foldThreadEvent(
      measured,
      threadStepMessagesEvent([Message.assistant('done')], {
        usage: new Usage({ inputTokens: 120_000, outputTokens: 900, totalTokens: 120_900 }),
        context: {
          runId: run.id,
          stepNumber: 0,
          provider: 'anthropic',
          model: 'claude-sonnet-5',
          contextWindow: 200_000,
          measuredAt: '2026-08-17T10:00:05.000Z',
        },
      })!,
    );
    expect(late.contextReading).toBe(measured.contextReading);
    expect(late.history).toHaveLength(1);
    const following = foldThreadEvent(
      late,
      threadStepMessagesEvent([], {
        usage: new Usage({ inputTokens: 130_000, totalTokens: 130_000 }),
        context: {
          runId: run.id,
          stepNumber: 1,
          provider: 'anthropic',
          model: 'claude-sonnet-5',
          contextWindow: 200_000,
          measuredAt: '2026-08-17T10:01:00.000Z',
        },
      })!,
    );
    expect(following.contextReading).toMatchObject({ stepNumber: 1, usage: { inputTokens: 130_000 } });
    expect(following.contextReading?.footprint).toBeUndefined();
  });
  test('a measurement after a rest appends one cache observation; a first request, a staled reading, a changed model, account or rung append none', () => {
    const measurement = (
      stepNumber: number,
      sentAt: string,
      measuredAt: string,
      model = 'claude-sonnet-5',
      account = 'work',
      reasoning = 'high',
    ) => ({
      runId: run.id,
      stepNumber,
      attempt: 0,
      provider: 'subscription',
      model,
      account,
      reasoning,
      usage: new Usage({ inputTokens: 120_000, cacheReadInputTokens: 110_000, totalTokens: 120_000 }),
      contextWindow: 1_000_000,
      inputLimit: null,
      footprint: { messages: 12, messageDigest: 'm', promptDigest: 'p', toolDigests: ['t'] },
      measuredAt,
      sentAt,
      cache: { ttlSeconds: 3_600 },
    });
    const first = foldThreadEvent(empty, threadMeasurementEvent(measurement(0, '2026-09-10T10:00:00.000Z', '2026-09-10T10:00:30.000Z')));
    expect(first.cacheObservations).toEqual([]);
    expect(first.contextReading).toMatchObject({ sentAt: '2026-09-10T10:00:00.000Z', cache: { ttlSeconds: 3_600 }, account: 'work' });
    const rested = foldThreadEvent(first, threadMeasurementEvent(measurement(1, '2026-09-10T10:07:30.000Z', '2026-09-10T10:07:45.000Z')));
    expect(rested.cacheObservations).toEqual([
      {
        runId: run.id,
        stepNumber: 1,
        provider: 'subscription',
        model: 'claude-sonnet-5',
        sentAt: '2026-09-10T10:07:30.000Z',
        gapMs: 420_000,
        inputTokens: 120_000,
        cacheReadTokens: 110_000,
      },
    ]);
    const staled = { ...rested, contextReading: { ...rested.contextReading!, stale: true }, cacheObservations: [] };
    expect(
      foldThreadEvent(staled, threadMeasurementEvent(measurement(2, '2026-09-10T10:20:00.000Z', '2026-09-10T10:20:10.000Z')))
        .cacheObservations,
    ).toEqual([]);
    const switched = foldThreadEvent(
      { ...rested, cacheObservations: [] },
      threadMeasurementEvent(measurement(2, '2026-09-10T10:20:00.000Z', '2026-09-10T10:20:10.000Z', 'claude-opus-5')),
    );
    expect(switched.cacheObservations).toEqual([]);
    const moved = foldThreadEvent(
      { ...rested, cacheObservations: [] },
      threadMeasurementEvent(measurement(2, '2026-09-10T10:20:00.000Z', '2026-09-10T10:20:10.000Z', 'claude-sonnet-5', 'personal')),
    );
    expect(moved.cacheObservations).toEqual([]);
    expect(moved.contextReading).toMatchObject({ account: 'personal' });
    const deeper = foldThreadEvent(
      { ...rested, cacheObservations: [] },
      threadMeasurementEvent(measurement(2, '2026-09-10T10:20:00.000Z', '2026-09-10T10:20:10.000Z', 'claude-sonnet-5', 'work', 'xhigh')),
    );
    expect(deeper.cacheObservations).toEqual([]);
    expect(deeper.contextReading).toMatchObject({ reasoning: 'xhigh' });
  });
  test('a log recorded before call measurements existed still reads its own figures', () => {
    const legacy = foldThreadEvent(
      empty,
      threadStepMessagesEvent([], {
        usage: new Usage({ inputTokens: 88_000, totalTokens: 88_000 }),
        context: {
          runId: run.id,
          stepNumber: 4,
          provider: 'anthropic',
          model: 'claude-sonnet-5',
          contextWindow: 200_000,
          measuredAt: '2026-08-17T09:00:00.000Z',
        },
      })!,
    );
    expect(legacy.contextReading).toMatchObject({ stepNumber: 4, usage: { inputTokens: 88_000 }, stale: false });
    expect(legacy.contextReading?.footprint).toBeUndefined();
  });
  test('an entry claims its id`s place: a later fact about the same thing transitions in place', () => {
    const call = foldThreadEvent(
      empty,
      threadEntryEvent({
        type: 'tool',
        id: 'tool:call-1',
        runId: 'run-1',
        toolCallId: 'call-1',
        toolState: 'input-available',
        toolInput: { path: 'a.ts' },
      }),
    );
    const withReply = foldThreadEvent(call, threadEntryEvent({ type: 'message', id: 'assistant:run-1', runId: 'run-1', text: 'Done.' }));
    const result = foldThreadEvent(
      withReply,
      threadEntryEvent({
        type: 'tool',
        id: 'tool:call-1',
        runId: 'run-1',
        toolCallId: 'call-1',
        toolState: 'output-available',
        toolInput: { path: 'a.ts' },
        toolOutput: { ok: true },
      }),
    );
    expect(result.transcript.map((entry) => entry.type)).toEqual(['tool', 'message']);
    expect(result.transcript[0]).toMatchObject({ toolState: 'output-available', toolOutput: { ok: true } });
  });
});
describe('appendThreadEventsIn', () => {
  it.live(
    'sealed facts land and answer their positions',
    Effect.fnUntraced(function* () {
      const inserts: ThreadEventInsert[] = [];
      const positions = yield* appendThreadEventsIn(
        journal(inserts),
        makeThreadEntryReader({ products: [] }),
        undefined,
        'thread-1',
        sealThreadEvents([threadSignalEvent(signal('one'), run.id), threadStepMessagesEvent([Message.assistant('two')])!]),
      );
      expect(positions).toEqual([1, 2]);
      expect(inserts.map((event) => event.kind)).toEqual(['signal', 'step']);
      expect(new Set(inserts.map((event) => event.id)).size).toBe(2);
    }),
  );
  it.live(
    'a payload that cannot be replayed is refused before it lands',
    Effect.fnUntraced(function* () {
      const inserts: ThreadEventInsert[] = [];
      const broken = { kind: 'step', payload: { messages: 'not a list of messages' } } as unknown as ThreadEventBody;
      const failure = yield* appendThreadEventsIn(journal(inserts), makeThreadEntryReader({ products: [] }), undefined, 'thread-1', [
        { id: 'event-1', body: broken },
      ]).pipe(Effect.flip);
      expect(failure._tag).toBe('ThreadStorageFailed');
      expect(inserts).toEqual([]);
    }),
  );
});
describe('sealThreadEvents', () => {
  test('each event is sealed with a freshly minted identity and folds in order', () => {
    const sealed = sealThreadEvents([threadSignalEvent(signal('one'), run.id), threadSystemPromptEvent(run.id, 'You are the agent.')]);
    const folded = sealed.reduce((state, { body }) => foldThreadEvent(state, body), empty as Parameters<typeof foldThreadEvent>[0]);
    expect(new Set(sealed.map((event) => event.id)).size).toBe(2);
    expect(folded.transcript.map((entry) => entry.type)).toEqual(['system-prompt', 'signal']);
  });
  test('a spoken entry is named by the id the door minted for its own row', () => {
    const [spoken] = sealThreadEvents([threadSpokenMessageEvent({ role: 'user', text: 'hello', occurredAt: '2026-08-17T10:00:00.000Z' })]);
    const folded = foldThreadEvent(empty, spoken!.body);
    expect(folded.transcript[0]?.id).toBe(`spoken:message:${spoken!.id}`);
  });
});
