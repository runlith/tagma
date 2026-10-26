import { it } from '@runlith/effect-test';
import { describe, expect, test } from 'bun:test';
import { Cause, Clock, Deferred, Effect, Fiber, Layer, PubSub, Schema, Stream } from 'effect';
import { entryOf, makeThreadEntryReader, ThreadEntryKinds, ThreadEntryUndecodable, type ThreadEntryReader } from '../../transcript/kinds';
import type { AgentEvent } from '../../agent/AgentEvent';
import { InputUsage, Usage, sumUsage } from '@runlith/llm/schema/events';
import { Message } from '@runlith/llm/schema/messages';
import { QuotaObservation, QuotaWindow } from '@runlith/llm/schema/quota';
import type { AgentRuntimeGuidance } from '../../agent/contracts';
import type { AgentStep } from '../../agent/AgentStep';
import type { ThreadRunProgress, ThreadRunRow } from '../rows';
import type { ThreadTranscript, ThreadTranscriptEntry } from '../../transcript/rows';
import type { ThreadEventInsert } from '../storage/eventLog';
import { makeAggregateStorage } from '../storage/InMemoryAggregateStorage';
import { threadPromise as tp } from '../conformance/border';
import { ThreadStorageFailed } from '../persisted';
import { ThreadTransitions, type ThreadToolOutputScopeFaces } from '../ThreadPorts';
import { threadRunSequencesLayer } from '../transition/sequence';
import { ThreadRunAccounting } from './ThreadRunAccounting';
import { type RunRequest, RunRequests } from './requests';
import { RunProgress } from './RunProgress';
import { makeThreadStreamRecorders } from './ThreadStreamRecorder';
import { ThreadSnapshots } from './ThreadSnapshots';
import { ThreadEventJournal, ThreadStore, ThreadStreamRhythm } from '../ThreadPorts';
import { ThreadJournalLane, writerOrderedLane } from '../transition/lane';
import { makeThreadLiveFeed, threadFeedLayer, type ThreadLiveEvent } from './ThreadLiveFeed';
import type { ThreadStateShape } from '../state';
import { FeedView } from '../../transcript/testing/feedView';
import { ThreadRunLedger } from './ThreadRunLedger';
import { ThreadStepObserver, type ThreadStepFinished } from '../ThreadStepObserver';
import { threadOpenChangeSchema } from '../../protocol/http';
const encodeOpenChange = Schema.encodeUnknownSync(Schema.toCodecJson(threadOpenChangeSchema));
describe('ThreadStreamRecorder', () => {
  it.live(
    'a reader folding the feed holds what the journal and the stream tail hold at each flush, text growing by its new characters',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      const recorder = yield* world.recorder();
      const reader = world.reader();
      const durable = () => [...world.store.transcript, ...(world.tail ?? [])];
      yield* recorder.push({ type: 'text-start', id: 'first' });
      for (const piece of ['  Hel', 'lo', ' wor', 'ld  ']) yield* recorder.push({ type: 'text-delta', id: 'first', text: piece });
      yield* recorder.push({ type: 'tool-call', id: 'call-1', name: 'read', input: { path: 'a' } });
      yield* recorder.flushRecorded();
      expect([...reader.transcript, ...reader.open]).toEqual(durable());
      yield* recorder.push({ type: 'tool-result', id: 'call-1', name: 'read', result: { type: 'json', value: { text: 'a' } } });
      yield* recorder.push({ type: 'text-end', id: 'first' });
      world.steps.push(step([Message.assistant('Hello world')]));
      yield* recorder.flushRecorded();
      expect(reader.transcript).toEqual(world.store.transcript);
      expect(reader.open).toEqual([]);
      yield* recorder.push({ type: 'text-start', id: 'next' });
      yield* recorder.push({ type: 'text-delta', id: 'next', text: 'live tail' });
      yield* recorder.stop();
      expect([...reader.transcript, ...reader.open]).toEqual(durable());
      expect(reader.gaps).toBe(0);
      const text = world.feedEvents.flatMap((event) =>
        event.type === 'open' && event.change.op !== 'progress' && 'id' in event.change && event.change.id === 'assistant:run-1'
          ? [event.change]
          : [],
      );
      const put = world.feedEvents.flatMap((event) =>
        event.type === 'open' && event.change.op === 'put' && event.change.entry.id === 'assistant:run-1' ? [event.change.entry] : [],
      );
      expect(put.filter(entryOf('message')).map((entry) => entry.text)).toEqual(['Hel']);
      expect(text.map((change) => (change.op === 'append' ? change.text : change.op))).toEqual(['lo', ' wor', 'ld']);
    }),
  );
  it.live(
    'a part closes into one event under its stable id; the open tail lives in the slot',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      const recorder = yield* world.recorder();
      yield* recorder.push({ type: 'text-start', id: 't1' });
      yield* recorder.push({ type: 'text-delta', id: 't1', text: 'First paragraph.' });
      yield* recorder.push({ type: 'text-end', id: 't1' });
      yield* recorder.push({ type: 'text-start', id: 't2' });
      yield* recorder.push({ type: 'text-delta', id: 't2', text: 'Half of the seco' });
      world.steps.push(step([Message.assistant('First paragraph.')]));
      yield* recorder.stop();
      expect(world.events.map((event) => event.kind)).toEqual(['message', 'step', 'step-finished']);
      expect(world.transcript()).toMatchObject([{ type: 'message', id: 'assistant:run-1', text: 'First paragraph.' }]);
      expect(world.tail).toMatchObject([{ type: 'message', id: 'assistant:run-1:text:1', text: 'Half of the seco' }]);
    }),
  );
  it.live(
    'a call billed before a tool that never finished is durable through the fence',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      const recorder = yield* world.recorder();
      yield* recorder.push({
        type: 'measurement',
        measurement: {
          runId: 'run-1',
          stepNumber: 0,
          attempt: 0,
          provider: 'anthropic',
          model: 'claude-sonnet-5',
          usage: new Usage({ inputTokens: 142_000, totalTokens: 142_000 }),
          contextWindow: 200_000,
          inputLimit: null,
          footprint: { messages: 9, messageDigest: 'm', promptDigest: 'p', toolDigests: ['t'] },
          measuredAt: '2026-09-05T00:00:00.000Z',
        },
      });
      yield* recorder.stop();
      expect(world.events.map((event) => event.kind)).toEqual(['measurement']);
      expect(world.history()).toEqual([]);
      expect(world.transcript()).toEqual([]);
    }),
  );
  it.live(
    'a closed part whose step never landed rides the tail instead of the log',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      const recorder = yield* world.recorder();
      yield* recorder.push({ type: 'text-start', id: 't1' });
      yield* recorder.push({ type: 'text-delta', id: 't1', text: 'First paragraph.' });
      yield* recorder.push({ type: 'text-end', id: 't1' });
      yield* recorder.stop();
      expect(world.events).toHaveLength(0);
      expect(world.history()).toEqual([]);
      expect(world.tail).toMatchObject([{ type: 'message', id: 'assistant:run-1', text: 'First paragraph.' }]);
    }),
  );
  it.live(
    'the thinking that produced an answer is recorded before it',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      const recorder = yield* world.recorder();
      yield* recorder.push({ type: 'reasoning-start', id: 'r1' });
      yield* recorder.push({ type: 'reasoning-delta', id: 'r1', text: 'Both points are fair; concede them.' });
      yield* recorder.push({ type: 'reasoning-end', id: 'r1' });
      yield* recorder.push({ type: 'text-start', id: 't1' });
      yield* recorder.push({ type: 'text-delta', id: 't1', text: 'Both points conceded.' });
      yield* recorder.push({ type: 'text-end', id: 't1' });
      world.steps.push(step([Message.assistant('Both points conceded.')]));
      yield* recorder.stop();
      expect(world.events.map((event) => event.kind)).toEqual(['reasoning', 'message', 'step', 'step-finished']);
      expect(world.transcript()).toMatchObject([
        { type: 'reasoning', text: 'Both points are fair; concede them.' },
        { type: 'message', role: 'assistant', text: 'Both points conceded.' },
      ]);
    }),
  );
  it.live(
    'a retry lands as its own entry between the torn words and the answer that followed',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      const recorder = yield* world.recorder();
      yield* recorder.push({ type: 'text-start', id: 't1' });
      yield* recorder.push({ type: 'text-delta', id: 't1', text: 'First words, cut' });
      yield* recorder.push({ type: 'text-end', id: 't1' });
      yield* recorder.push({
        type: 'retry',
        stepNumber: 0,
        attempt: 1,
        of: 5,
        family: 'torn-stream',
        delayMs: 200,
        message: 'Failed to read the stream',
      });
      yield* recorder.push({ type: 'text-start', id: 't2' });
      yield* recorder.push({ type: 'text-delta', id: 't2', text: 'Whole answer.' });
      yield* recorder.push({ type: 'text-end', id: 't2' });
      world.steps.push(step([Message.assistant('Whole answer.')]));
      yield* recorder.stop();
      expect(world.events.map((event) => event.kind)).toEqual(['message', 'retry', 'message', 'step', 'step-finished']);
      expect(world.transcript()).toMatchObject([
        { type: 'message', role: 'assistant', text: 'First words, cut' },
        { type: 'retry', id: 'retry:run-1:0:1', runId: 'run-1', attempt: 1, of: 5, family: 'torn-stream', delayMs: 200 },
        { type: 'message', role: 'assistant', text: 'Whole answer.' },
      ]);
      expect(world.history().filter((message) => message.role === 'assistant')).toHaveLength(1);
    }),
  );
  it.live(
    'thinking closed before the step intent lands ahead of the call it produced',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      const recorder = yield* world.recorder();
      const assistant: Message = {
        role: 'assistant',
        content: [{ type: 'tool-call', id: 'call-1', name: 'write_file', input: { path: 'a.txt' } }],
      };
      yield* recorder.push({ type: 'reasoning-start', id: 'r1' });
      yield* recorder.push({ type: 'reasoning-delta', id: 'r1', text: 'The file has to be written first.' });
      yield* recorder.push({ type: 'reasoning-end', id: 'r1' });
      yield* recorder.commitStepIntent({
        stepNumber: 0,
        messages: [assistant],
        calls: [{ toolCallId: 'call-1', toolName: 'write_file', input: { path: 'a.txt' } }],
      });
      expect(world.events.map((event) => event.kind)).toEqual(['reasoning', 'step', 'tool']);
    }),
  );
  it.live(
    'a part closed behind waiting words waits with them, in the slot',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      const recorder = yield* world.recorder();
      yield* recorder.push({ type: 'text-start', id: 't1' });
      yield* recorder.push({ type: 'text-delta', id: 't1', text: 'One moment.' });
      yield* recorder.push({ type: 'text-end', id: 't1' });
      yield* recorder.push({ type: 'reasoning-start', id: 'r1' });
      yield* recorder.push({ type: 'reasoning-delta', id: 'r1', text: 'Now the harder half.' });
      yield* recorder.push({ type: 'reasoning-end', id: 'r1' });
      yield* recorder.stop();
      expect(world.events).toHaveLength(0);
      expect(world.tail).toMatchObject([
        { type: 'message', role: 'assistant', text: 'One moment.' },
        { type: 'reasoning', text: 'Now the harder half.' },
      ]);
    }),
  );
  it.live(
    'a tool call and its result are two facts transitioning one entry, with its ready answers',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      const recorder = yield* world.recorder();
      yield* recorder.push({ type: 'tool-input-start', id: 'call-1', name: 'offer_ready_answers' });
      yield* recorder.push({
        type: 'tool-call',
        id: 'call-1',
        name: 'offer_ready_answers',
        input: {
          answers: [
            { label: 'Yes', send: 'Yes' },
            { label: 'No', send: 'No' },
          ],
        },
      });
      yield* recorder.push({
        type: 'tool-result',
        id: 'call-1',
        name: 'offer_ready_answers',
        result: { type: 'json', value: { status: 'offered' } },
      });
      yield* recorder.stop();
      expect(world.events.map((event) => event.kind)).toEqual(['tool', 'ready-answers', 'tool']);
      expect(world.transcript()).toMatchObject([
        { type: 'tool', id: 'tool:call-1', toolState: 'output-available', toolOutput: { status: 'offered' } },
        { type: 'ready-answers', id: 'transcript:ready-answers:run-1:call-1' },
      ]);
    }),
  );
  it.live(
    'invalid ready answers record the refusal without publishing choices',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      const recorder = yield* world.recorder();
      yield* recorder.push({ type: 'tool-call', id: 'invalid', name: 'offer_ready_answers', input: { answers: [] } });
      yield* recorder.push({
        type: 'tool-outcome',
        toolCallId: 'invalid',
        toolName: 'offer_ready_answers',
        outcome: { kind: 'refused', refusal: { code: 'body-shape', reason: 'Input is invalid.' } },
      });
      yield* recorder.stop();
      expect(world.transcript()).toMatchObject([
        { type: 'tool', toolCallId: 'invalid', toolState: 'output-refused', toolRefusal: { code: 'body-shape' } },
      ]);
      expect(world.transcript().filter((entry) => entry.type === 'ready-answers')).toEqual([]);
    }),
  );
  it.live(
    'a settled call whose output holds an unset member reaches the live feed and the journal as one document the wire carries',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      const recorder = yield* world.recorder();
      const refused: {
        readonly status: string;
        readonly code: string;
        readonly argument?: string;
      } = {
        status: 'refused',
        code: 'body-shape',
        argument: undefined,
      };
      yield* recorder.push({ type: 'tool-call', id: 'call-1', name: 'read', input: { path: 'a', timeout: 60000 } });
      yield* recorder.push({
        type: 'tool-outcome',
        toolCallId: 'call-1',
        toolName: 'read',
        outcome: { kind: 'refused', refusal: { code: 'body-shape', reason: 'unknown argument timeout' }, output: refused },
      });
      const puts = world.feedEvents.flatMap((event) => (event.type === 'open' && event.change.op === 'put' ? [event.change] : []));
      const live = puts.at(-1);
      expect(live).toMatchObject({ entry: { toolState: 'output-refused', toolOutput: { status: 'refused', code: 'body-shape' } } });
      for (const put of puts) expect(() => encodeOpenChange(put)).not.toThrow();
      yield* recorder.flushRecorded();
      expect(world.store.transcript.find((entry) => entry.id === 'tool:call-1')).toEqual(live?.op === 'put' ? live.entry : undefined);
    }),
  );
  it.live(
    'the form a call answered with is written onto its settled entry',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      const recorder = yield* world.recorder();
      yield* recorder.push({ type: 'tool-input-start', id: 'call-1', name: 'read' });
      yield* recorder.push({ type: 'tool-call', id: 'call-1', name: 'read', input: { filePath: 'a.ts' } });
      yield* recorder.push({
        type: 'tool-display',
        toolCallId: 'call-1',
        display: { form: 'code', title: 'a.ts', text: 'const a = 1', path: 'a.ts', firstLine: 1 },
      });
      yield* recorder.push({ type: 'tool-result', id: 'call-1', name: 'read', result: { type: 'text', value: 'a.ts' } });
      yield* recorder.stop();
      expect(world.transcript()).toMatchObject([
        {
          type: 'tool',
          toolCallId: 'call-1',
          toolState: 'output-available',
          toolDisplay: { form: 'code', title: 'a.ts', text: 'const a = 1', path: 'a.ts', firstLine: 1 },
        },
      ]);
    }),
  );
  it.live(
    'a call still running when the record flushes carries the form a reader arrives at',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      const recorder = yield* world.recorder();
      const input = { to: 'critic', task: 'Read the diff and report the findings.' };
      const assistant: Message = {
        role: 'assistant',
        content: [{ type: 'tool-call', id: 'call-1', name: 'send_task', input }],
      };
      yield* recorder.commitStepIntent({
        stepNumber: 0,
        messages: [assistant],
        calls: [{ toolCallId: 'call-1', toolName: 'send_task', input }],
      });
      yield* recorder.push({ type: 'tool-display', toolCallId: 'call-1', display: { form: 'none', title: 'critic' } });
      yield* recorder.flushRecorded();
      expect(world.transcript()).toMatchObject([
        {
          type: 'tool',
          toolCallId: 'call-1',
          toolState: 'input-available',
          toolDisplay: { form: 'none', title: 'critic' },
        },
      ]);
    }),
  );
  it.live(
    'a call that answers inside the same window writes its form once, on the settled entry',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      const recorder = yield* world.recorder();
      const input = { filePath: 'a.ts' };
      yield* recorder.commitStepIntent({
        stepNumber: 0,
        messages: [{ role: 'assistant', content: [{ type: 'tool-call', id: 'call-1', name: 'read', input }] }],
        calls: [{ toolCallId: 'call-1', toolName: 'read', input }],
      });
      yield* recorder.push({ type: 'tool-display', toolCallId: 'call-1', display: { form: 'none', title: 'a.ts' } });
      yield* recorder.push({
        type: 'tool-display',
        toolCallId: 'call-1',
        display: { form: 'code', title: 'a.ts', text: 'const a = 1', path: 'a.ts', firstLine: 1 },
      });
      yield* recorder.push({ type: 'tool-result', id: 'call-1', name: 'read', result: { type: 'text', value: 'a.ts' } });
      yield* recorder.stop();
      expect(world.events.map((event) => event.kind)).toEqual(['step', 'tool', 'tool']);
      expect(world.transcript()).toMatchObject([
        {
          type: 'tool',
          toolCallId: 'call-1',
          toolState: 'output-available',
          toolDisplay: { form: 'code', title: 'a.ts', text: 'const a = 1' },
        },
      ]);
    }),
  );
  it.live(
    'a completed step lands its model messages after a guidance frame that precedes it',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      const recorder = yield* world.recorder();
      yield* recorder.push({ type: 'data-runtime-guidance', id: 'guidance-1', data: guidanceFrame('guidance-1', 0) });
      world.steps.push(step([Message.assistant('Step zero reply.')]));
      yield* recorder.push({ type: 'text-start', id: 't1' });
      yield* recorder.push({ type: 'text-delta', id: 't1', text: 'Step zero reply.' });
      yield* recorder.push({ type: 'text-end', id: 't1' });
      yield* recorder.stop();
      expect(world.events.map((event) => event.kind)).toEqual(['message', 'runtime-guidance', 'step', 'step-finished']);
      const history = world.history();
      expect(history.at(-1)).toMatchObject(Message.assistant('Step zero reply.'));
      expect(history.at(-2)?.role).toBe('user');
      expect(world.committed).toHaveLength(1);
    }),
  );
  it.live(
    'a step`s bill names the window its own projection measured, not the run`s latest',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      world.contextWindow = 1_000_000;
      const recorder = yield* world.recorder();
      world.steps.push(step([Message.assistant('Answer.')], new Usage({ totalTokens: 1_000 })));
      yield* recorder.push({ type: 'context-estimate', stepNumber: 0, tokens: 900, contextWindow: 200_000 });
      yield* recorder.push({ type: 'step-finish', index: 0, reason: 'stop', usage: new Usage({ totalTokens: 1_000 }) });
      yield* recorder.stop();
      const billed = world.events.find((event) => event.kind === 'step');
      expect(billed?.payload).toMatchObject({ context: { stepNumber: 0, contextWindow: 200_000 } });
    }),
  );
  it.live(
    'a model request lands once, when the model answers, before its step lands',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      const recorder = yield* world.recorder();
      yield* recorder.push({
        type: 'step-finish',
        index: 0,
        reason: 'tool-calls',
        usage: new Usage({ inputTokens: 1_000, totalTokens: 1_100 }),
      });
      yield* recorder.flushRecorded();
      expect(world.landed).toMatchObject([{ stepNumber: 0, attempt: 0, usage: { inputTokens: 1_000, totalTokens: 1_100 } }]);
      world.steps.push(step([Message.assistant('One.')], new Usage({ inputTokens: 1_000, totalTokens: 1_100 })));
      world.steps.push(step([Message.assistant('Two.')], new Usage({ inputTokens: 2_000, totalTokens: 2_200 })));
      yield* recorder.stop();
      expect(world.landed.map((request) => [request.stepNumber, request.usage?.totalTokens])).toEqual([
        [0, 1_100],
        [1, 2_200],
      ]);
    }),
  );
  it.live(
    'a provider that counts the prompt early gives the step its occupancy before the bill',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      const recorder = yield* world.recorder();
      world.steps.push({ ...step([Message.assistant('Answer.')]), usage: undefined });
      yield* recorder.push({ type: 'context-estimate', stepNumber: 0, tokens: 900, contextWindow: 200_000 });
      yield* recorder.push({ type: 'input-usage', inputUsage: new InputUsage({ inputTokens: 4_200 }) });
      yield* recorder.stop();
      const billed = world.events.find((event) => event.kind === 'step');
      expect(billed?.payload.usage).toMatchObject({ inputTokens: 4_200 });
    }),
  );
  it.live(
    'a step with no estimate of its own falls back to the run`s capacity',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      world.contextWindow = 1_000_000;
      const recorder = yield* world.recorder();
      world.steps.push(step([Message.assistant('Answer.')], new Usage({ totalTokens: 1_000 })));
      yield* recorder.stop();
      const billed = world.events.find((event) => event.kind === 'step');
      expect(billed?.payload).toMatchObject({ context: { contextWindow: 1_000_000 } });
    }),
  );
  it.live(
    'a step the provider reported nothing for bills nothing',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      const recorder = yield* world.recorder();
      world.steps.push(step([Message.assistant('Answer.')]));
      yield* recorder.stop();
      const event = world.events.find((entry) => entry.kind === 'step');
      expect(event?.payload.usage).toBeUndefined();
      expect(event?.payload.context).toMatchObject({ runId: 'run-1', stepNumber: 0 });
      expect(world.store.contextReading).toBeNull();
    }),
  );
  it.live(
    'a resumed run continues its identity sequence and never restates recorded tool calls',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld({
        transcript: [
          { type: 'message', id: 'assistant:run-1', role: 'assistant', runId: 'run-1', text: 'Before the park.' },
          {
            type: 'tool',
            id: 'tool:ask-1',
            runId: 'run-1',
            toolCallId: 'ask-1',
            toolName: 'ask_user',
            toolState: 'output-available',
            toolOutput: { status: 'answered' },
          },
        ],
      });
      const recorder = yield* world.recorder();
      yield* recorder.push({ type: 'tool-call', id: 'ask-1', name: 'ask_user', input: {} });
      yield* recorder.push({
        type: 'tool-result',
        id: 'ask-1',
        name: 'ask_user',
        result: { type: 'json', value: { status: 'answered' } },
      });
      yield* recorder.push({ type: 'text-start', id: 't1' });
      yield* recorder.push({ type: 'text-delta', id: 't1', text: 'After the answer.' });
      yield* recorder.push({ type: 'text-end', id: 't1' });
      world.steps.push(step([Message.assistant('After the answer.')]));
      yield* recorder.stop();
      expect(world.events.map((event) => event.kind)).toEqual(['message', 'step', 'step-finished']);
      expect(world.events[0]?.payload).toMatchObject({
        entry: { id: 'assistant:run-1:text:1', text: 'After the answer.' },
      });
    }),
  );
  it.live(
    'a resumed run`s steps are numbered on, so its retries do not take an id the run already spent',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld({
        transcript: [
          {
            type: 'retry',
            id: 'retry:run-1:0:1',
            runId: 'run-1',
            stepNumber: 0,
            attempt: 1,
            of: 3,
            family: 'transport',
            delayMs: 0,
            occurredAt: '2026-06-19T12:00:00.000Z',
          },
        ],
        stepsTaken: 1,
      });
      const recorder = yield* world.recorder();
      yield* recorder.push({ type: 'retry', stepNumber: 1, attempt: 1, of: 3, family: 'transport', delayMs: 0, message: 'again' });
      yield* recorder.push({ type: 'text-start', id: 't1' });
      yield* recorder.push({ type: 'text-delta', id: 't1', text: 'After the retry.' });
      yield* recorder.push({ type: 'text-end', id: 't1' });
      world.steps.push(step([Message.assistant('After the retry.')]));
      yield* recorder.stop();
      const retries = world.events.flatMap((event) =>
        (
          event.payload.entry as
            | {
                type?: string;
                id?: string;
              }
            | undefined
        )?.type === 'retry'
          ? [
              (
                event.payload.entry as {
                  id: string;
                }
              ).id,
            ]
          : [],
      );
      expect(retries).toEqual(['retry:run-1:1:1']);
      expect(world.events.find((event) => event.kind === 'step-finished')?.payload.context).toMatchObject({
        runId: 'run-1',
        stepNumber: 1,
      });
    }),
  );
  it.live(
    'a streaming tool input reaches the slot as the characters that arrived',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      const recorder = yield* world.recorder();
      const arrived = '{"question": "Опыт по фронту", "anchors": ["Стейт фо';
      yield* recorder.push({ type: 'tool-input-start', id: 'call-1', name: 'publish_cue' });
      yield* recorder.push({ type: 'tool-input-delta', id: 'call-1', name: 'publish_cue', text: arrived });
      yield* recorder.push({ type: 'tool-display', toolCallId: 'call-1', display: { form: 'none', title: 'Опыт по фронту' } });
      yield* recorder.flushRecorded();
      expect(world.events).toHaveLength(0);
      expect(world.tail).toEqual([
        {
          type: 'tool',
          id: 'tool:call-1',
          runId: 'run-1',
          toolName: 'publish_cue',
          toolCallId: 'call-1',
          toolState: 'input-streaming',
          toolInputRaw: { kind: 'text', text: arrived, complete: false },
          toolDisplay: { form: 'none', title: 'Опыт по фронту' },
          occurredAt: expect.any(String),
        },
      ]);
    }),
  );
  it.live(
    'the slot carries the same words and input however the stream splits them, flush after flush',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      const recorder = yield* world.recorder();
      const words = ['\u00a0 \r', '\nFirst line\r', '\r\nsecond', ' line\r', '', '\n\t', 'last\u2028 \r'];
      const input = ['{"path":"a', '.ts","body":"one\\', 'ntwo","n":-1', '2.5e', '+1', ',"done":tr'];
      const said = (upTo: number) => words.slice(0, upTo).join('').replace(/\r\n?/g, '\n').trim();
      const typed = (upTo: number) => input.slice(0, upTo).join('');
      yield* recorder.push({ type: 'text-start', id: 't1' });
      yield* recorder.push({ type: 'tool-input-start', id: 'call-1', name: 'write' });
      for (let index = 0; index < words.length; index += 1) {
        yield* recorder.push({ type: 'text-delta', id: 't1', text: words[index] as string });
        const piece = input[index];
        if (piece !== undefined) yield* recorder.push({ type: 'tool-input-delta', id: 'call-1', name: 'write', text: piece });
        yield* recorder.flushRecorded();
        const upTo = index + 1;
        const tail = world.tail ?? [];
        expect(tail.find(entryOf('message'))?.text ?? '').toBe(said(upTo));
        expect(tail.find((entry) => entry.type === 'tool')).toMatchObject({
          toolInputRaw: { kind: 'text', text: typed(Math.min(upTo, input.length)) },
        });
      }
      yield* recorder.push({ type: 'text-end', id: 't1' });
      world.steps.push(step([Message.assistant(said(words.length))]));
      yield* recorder.stop();
      expect(world.transcript().filter((entry) => entry.type === 'message')).toMatchObject([
        { type: 'message', id: 'assistant:run-1', text: said(words.length) },
      ]);
    }),
  );
  it.live(
    'an ending closes an input that was still arriving, and spills it through the host first',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      const recorder = yield* world.recorder();
      const received = '{"filePath":"/tmp/a","content":"half a document';
      yield* recorder.push({ type: 'tool-input-start', id: 'call-1', name: 'write' });
      yield* recorder.push({ type: 'tool-input-delta', id: 'call-1', name: 'write', text: received });
      yield* recorder.stop();
      expect(world.events).toMatchObject([
        {
          kind: 'tool',
          payload: { entry: { toolState: 'input-interrupted', toolInputRaw: { kind: 'text', text: received } } },
        },
      ]);
      expect(world.tail).toBeNull();
    }),
  );
  it.live(
    'a call the request stopped mid-argument keeps the characters that arrived, exactly',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      const recorder = yield* world.recorder();
      const received = '{"filePath":"/tmp/a.html","content":"<p>caf\\u00e9</p><p>\\u00e';
      yield* recorder.push({ type: 'tool-input-start', id: 'call-1', name: 'write' });
      yield* recorder.push({ type: 'tool-input-delta', id: 'call-1', name: 'write', text: received });
      yield* recorder.push({ type: 'tool-input-interrupted', toolCallId: 'call-1', toolName: 'write', stepNumber: 0, attempt: 0 });
      yield* recorder.stop();
      expect(world.events).toMatchObject([
        {
          kind: 'tool',
          payload: {
            entry: {
              type: 'tool',
              id: 'tool:call-1',
              toolState: 'input-interrupted',
              toolInputRaw: { kind: 'text', text: received, complete: false },
              interruption: { stepNumber: 0, attempt: 0 },
            },
          },
        },
      ]);
      expect(world.events[0]?.payload.entry).not.toHaveProperty('toolInput');
      expect(world.events[0]?.payload).not.toHaveProperty('messages');
    }),
  );
  it.live(
    'characters the host cannot keep are recorded as unavailable, never as none at all',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      world.refuseRetention = true;
      const recorder = yield* world.recorder();
      yield* recorder.push({ type: 'tool-input-start', id: 'call-1', name: 'write' });
      yield* recorder.push({ type: 'tool-input-delta', id: 'call-1', name: 'write', text: '{"content":"half a doc' });
      yield* recorder.push({ type: 'tool-input-interrupted', toolCallId: 'call-1', toolName: 'write', stepNumber: 0, attempt: 0 });
      yield* recorder.stop();
      expect(world.events).toMatchObject([
        {
          payload: {
            entry: {
              toolState: 'input-interrupted',
              toolInputRaw: { kind: 'unavailable', byteLength: 22, reason: expect.stringContaining('call-1') },
            },
          },
        },
      ]);
    }),
  );
  it.live(
    'the fence answers only once the interrupted call is durable, and says what the record holds',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      const recorder = yield* world.recorder();
      const received = '{"filePath":"/tmp/a","content":"half a document';
      yield* recorder.push({ type: 'tool-input-start', id: 'call-1', name: 'write' });
      yield* recorder.push({ type: 'tool-input-delta', id: 'call-1', name: 'write', text: received });
      expect(world.events).toHaveLength(0);
      yield* recorder.push({ type: 'tool-input-interrupted', toolCallId: 'call-1', toolName: 'write', stepNumber: 0, attempt: 0 });
      const receipts = yield* recorder.interruptedRecorded(['call-1']);
      expect(world.events).toMatchObject([
        { kind: 'tool', payload: { entry: { toolState: 'input-interrupted', toolInputRaw: { kind: 'text', text: received } } } },
      ]);
      expect(receipts.get('call-1')).toEqual({ kind: 'text', text: received, complete: false });
    }),
  );
  it.live(
    'the fence waits for the actual atomic unit, and a refused unit retries the same input',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      const recorder = yield* world.recorder();
      const received = '{"filePath":"/tmp/a","content":"half a document';
      world.commitGate = Deferred.makeUnsafe<void>();
      yield* recorder.push({ type: 'tool-input-start', id: 'call-1', name: 'write' });
      yield* recorder.push({ type: 'tool-input-delta', id: 'call-1', name: 'write', text: received });
      yield* recorder.push({ type: 'tool-input-interrupted', toolCallId: 'call-1', toolName: 'write', stepNumber: 4, attempt: 2 });
      const waiting = yield* Effect.forkScoped(recorder.interruptedRecorded(['call-1']));
      yield* Deferred.await(world.commitStarted);
      expect(world.transcript()).toEqual([]);
      Deferred.doneUnsafe(world.commitGate, Effect.void);
      yield* Fiber.join(waiting);
      expect(world.transcript()).toMatchObject([{ toolState: 'input-interrupted', toolInputRaw: { text: received } }]);
      const retryWorld = yield* recorderWorld();
      const retryRecorder = yield* retryWorld.recorder();
      retryWorld.store.updateFailure = new Error('unit refused');
      yield* retryRecorder.push({ type: 'tool-input-start', id: 'call-2', name: 'write' });
      yield* retryRecorder.push({ type: 'tool-input-delta', id: 'call-2', name: 'write', text: received });
      yield* retryRecorder.push({ type: 'tool-input-interrupted', toolCallId: 'call-2', toolName: 'write', stepNumber: 4, attempt: 2 });
      expect(
        yield* Effect.matchCause(retryRecorder.interruptedRecorded(['call-2']), { onFailure: Cause.squash, onSuccess: () => null }),
      ).toMatchObject({ message: expect.stringContaining('unit refused') });
      expect(retryWorld.transcript()).toEqual([]);
      retryWorld.store.updateFailure = null;
      const receipts = yield* retryRecorder.interruptedRecorded(['call-2']);
      expect(receipts.get('call-2')).toMatchObject({ kind: 'text', text: received });
      expect(retryWorld.transcript()).toMatchObject([{ toolState: 'input-interrupted', toolInputRaw: { text: received } }]);
    }),
  );
  it.live(
    'interrupted input is read from the committed tail and then its settled entry on repeated recovery',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      const recorder = yield* world.recorder();
      yield* recorder.push({ type: 'text-start', id: 't' });
      yield* recorder.push({ type: 'text-delta', id: 't', text: 'Shown words.' });
      yield* recorder.push({ type: 'text-end', id: 't' });
      yield* recorder.push({ type: 'tool-input-start', id: 'call', name: 'write' });
      yield* recorder.push({ type: 'tool-input-delta', id: 'call', name: 'write', text: '{"body":"half' });
      yield* recorder.push({ type: 'tool-input-interrupted', toolCallId: 'call', toolName: 'write', stepNumber: 0, attempt: 0 });
      const first = yield* recorder.interruptedRecorded(['call']);
      expect(first.get('call')).toEqual({ kind: 'text', text: '{"body":"half', complete: false });
      expect(world.tail).toMatchObject([{ type: 'message' }, { type: 'tool', toolState: 'input-interrupted' }]);
      world.steps.push(step([Message.assistant('Shown words.')]));
      expect(yield* recorder.interruptedRecorded(['call'])).toEqual(first);
      yield* recorder.stop();
      expect(yield* recorder.interruptedRecorded(['call'])).toEqual(first);
      expect(world.tail).toBeNull();
    }),
  );
  it.live(
    'a live input tail spills through the host and drops its speculative duplicate',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      world.retainAbove = 20;
      const recorder = yield* world.recorder();
      const received = `{"content":"${'x'.repeat(1_000)}`;
      yield* recorder.push({ type: 'tool-input-start', id: 'call-1', name: 'write' });
      yield* recorder.push({ type: 'tool-input-delta', id: 'call-1', name: 'write', text: received });
      yield* recorder.flushRecorded();
      expect(world.tail).toMatchObject([
        { toolState: 'input-streaming', toolInputRaw: { kind: 'retained', outputId: 'kept-call-1', byteLength: received.length } },
      ]);
      expect(world.tail?.[0]).not.toHaveProperty('toolInput');
      expect(JSON.stringify(world.tail).length).toBeLessThan(received.length);
    }),
  );
  it.live(
    'a fence over a call this run never took in answers that it never landed',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      const recorder = yield* world.recorder();
      yield* recorder.stop();
      expect(yield* recorder.interruptedRecorded(['call-missing'])).toEqual(new Map());
    }),
  );
  it.live(
    'a retry keeps the wire record of the attempt that broke, so a later success cannot erase it',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      const recorder = yield* world.recorder();
      yield* recorder.push({
        type: 'retry',
        stepNumber: 0,
        attempt: 1,
        of: 5,
        family: 'torn-stream',
        delayMs: 200,
        message: 'the stream tore',
        reason: { family: 'torn-stream', status: 200, bytesRead: 3_635_222, lastEvent: { type: 'tool-input-delta', count: 13_746 } },
      });
      yield* recorder.stop();
      expect(world.events).toMatchObject([
        {
          kind: 'retry',
          payload: {
            entry: {
              type: 'retry',
              family: 'torn-stream',
              reason: { family: 'torn-stream', status: 200, bytesRead: 3_635_222, lastEvent: { type: 'tool-input-delta', count: 13_746 } },
            },
          },
        },
      ]);
    }),
  );
  it.live(
    'the step intent keeps the subject published while its input streamed',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      const recorder = yield* world.recorder();
      const input = { name: 'critic', task: 'Review the contract' };
      yield* recorder.push({ type: 'tool-input-start', id: 'call-1', name: 'spawn_agent' });
      yield* recorder.push({
        type: 'tool-input-delta',
        id: 'call-1',
        name: 'spawn_agent',
        text: '{"name":"critic","task":"Review the contract"}',
      });
      yield* recorder.push({ type: 'tool-display', toolCallId: 'call-1', display: { form: 'none', title: 'critic' } });
      yield* recorder.push({ type: 'tool-call', id: 'call-1', name: 'spawn_agent', input });
      yield* recorder.commitStepIntent({
        stepNumber: 0,
        messages: [{ role: 'assistant', content: [{ type: 'tool-call', id: 'call-1', name: 'spawn_agent', input }] }],
        calls: [{ toolCallId: 'call-1', toolName: 'spawn_agent', input }],
      });
      expect(world.transcript()).toMatchObject([
        {
          type: 'tool',
          toolCallId: 'call-1',
          toolState: 'input-available',
          toolDisplay: { form: 'none', title: 'critic' },
        },
      ]);
    }),
  );
  it.live(
    'a failing final flush rejects the settle fence and the next stop retries it',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      world.store.updateFailure = new Error('event page write lost');
      const recorder = yield* world.recorder();
      yield* recorder.push({ type: 'text-start', id: 't1' });
      yield* recorder.push({ type: 'text-delta', id: 't1', text: 'Shown but never recorded.' });
      yield* recorder.push({ type: 'text-end', id: 't1' });
      expect(yield* Effect.matchCause(recorder.stop(), { onFailure: Cause.squash, onSuccess: () => null })).toMatchObject({
        message: expect.stringContaining('event page write lost'),
      });
      expect(world.events).toHaveLength(0);
      world.store.updateFailure = null;
      yield* recorder.stop();
      expect(world.store.updates).toBe(2);
      expect(world.tail).toMatchObject([{ type: 'message', id: 'assistant:run-1' }]);
    }),
  );
  it.live(
    'a part of an installed product kind is journaled decoded; a core-kind part is left to its owner; an unread kind fails the push',
    Effect.fnUntraced(function* () {
      const practice = Schema.Struct({ type: Schema.tag('practice-task'), id: Schema.String, title: Schema.String });
      const world = yield* recorderWorld();
      world.kinds = makeThreadEntryReader({ products: [{ type: 'practice-task', schema: practice }] });
      const recorder = yield* world.recorder();
      const part = (data: unknown) => ({ type: 'data-transcript-entry', id: 'part', data }) as AgentEvent;
      yield* recorder.push(part({ type: 'practice-task', id: 'task-1', title: 'Spell the word' }));
      yield* recorder.push(part({ type: 'message', id: 'echo', role: 'assistant', text: 'owned elsewhere' }));
      const refused = (data: unknown) =>
        Effect.map(Effect.flip(recorder.push(part(data))), (failure) => (failure._tag === 'ThreadCallBroke' ? failure.cause : failure));
      expect(yield* refused({ type: 'practice-task', id: 'task-2' })).toBeInstanceOf(ThreadEntryUndecodable);
      expect(yield* refused({ type: 'nobody-reads-this', id: 'x' })).toBeInstanceOf(ThreadEntryUndecodable);
      yield* recorder.stop();
      expect(world.transcript() as unknown).toEqual([{ type: 'practice-task', id: 'task-1', title: 'Spell the word' }]);
    }),
  );
  it.live(
    'the step intent lands the assistant half and the call before the effect; the step event carries the remainder',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      const recorder = yield* world.recorder();
      const assistant: Message = {
        role: 'assistant',
        content: [{ type: 'tool-call', id: 'call-1', name: 'write_file', input: { path: 'a.txt' } }],
      };
      yield* recorder.commitStepIntent({
        stepNumber: 0,
        messages: [assistant],
        calls: [{ toolCallId: 'call-1', toolName: 'write_file', input: { path: 'a.txt' } }],
      });
      expect(world.events.map((event) => event.kind)).toEqual(['step', 'tool']);
      expect(world.transcript()).toMatchObject([
        { type: 'tool', id: 'tool:call-1', toolState: 'input-available', toolInput: { path: 'a.txt' } },
      ]);
      expect(world.history()).toMatchObject([assistant]);
      yield* recorder.push({ type: 'tool-call', id: 'call-1', name: 'write_file', input: { path: 'a.txt' } });
      yield* recorder.push({
        type: 'tool-result',
        id: 'call-1',
        name: 'write_file',
        result: { type: 'json', value: { written: true } },
      });
      world.steps.push(
        step([
          assistant,
          {
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                id: 'call-1',
                name: 'write_file',
                result: { type: 'json', value: { written: true } },
              },
            ],
          },
        ]),
      );
      yield* recorder.stop();
      expect(world.events.map((event) => event.kind)).toEqual(['step', 'tool', 'tool', 'step', 'step-finished']);
      expect(world.transcript()).toMatchObject([
        { type: 'tool', id: 'tool:call-1', toolState: 'output-available', toolOutput: { written: true } },
      ]);
      expect(world.history().map((message) => message.role)).toEqual(['assistant', 'tool']);
    }),
  );
  it.live(
    'a guidance frame for an intent-committed step lands before its assistant half, never between a call and its result',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      const recorder = yield* world.recorder();
      const assistant: Message = {
        role: 'assistant',
        content: [{ type: 'tool-call', id: 'call-1', name: 'write_file', input: { path: 'a.txt' } }],
      };
      yield* recorder.push({ type: 'data-runtime-guidance', id: 'guidance-1', data: guidanceFrame('guidance-1', 0) });
      yield* recorder.commitStepIntent({
        stepNumber: 0,
        messages: [assistant],
        calls: [{ toolCallId: 'call-1', toolName: 'write_file', input: { path: 'a.txt' } }],
      });
      yield* recorder.push({
        type: 'tool-result',
        id: 'call-1',
        name: 'write_file',
        result: { type: 'json', value: { written: true } },
      });
      world.steps.push(
        step([
          assistant,
          {
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                id: 'call-1',
                name: 'write_file',
                result: { type: 'json', value: { written: true } },
              },
            ],
          },
        ]),
      );
      yield* recorder.stop();
      expect(world.events.map((event) => event.kind)).toEqual(['runtime-guidance', 'step', 'tool', 'tool', 'step', 'step-finished']);
      expect(world.history().map((message) => message.role)).toEqual(['user', 'assistant', 'tool']);
    }),
  );
  it.live(
    'a chunk fact queued before the intent write is dropped as its duplicate',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      const recorder = yield* world.recorder();
      yield* recorder.push({ type: 'tool-call', id: 'call-1', name: 'write_file', input: {} });
      yield* recorder.commitStepIntent({
        stepNumber: 0,
        messages: [],
        calls: [{ toolCallId: 'call-1', toolName: 'write_file', input: {} }],
      });
      yield* recorder.stop();
      expect(world.events.map((event) => event.kind)).toEqual(['tool']);
      expect(world.transcript()).toMatchObject([{ type: 'tool', id: 'tool:call-1', toolState: 'input-available' }]);
    }),
  );
  it.live(
    'two subscribers read the same steps in order',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      const recorder = yield* world.recorder();
      const quota = new QuotaObservation({
        observedAt: new Date(yield* Clock.currentTimeMillis),
        source: 'reply',
        windows: [new QuotaWindow({ kind: 'session', usedPercent: 61 })],
      });
      const read = Stream.fromPubSub(world.stepHub).pipe(Stream.take(2), Stream.runCollect);
      const [first, second] = yield* Effect.gen(function* () {
        const left = yield* Effect.forkChild(read);
        const right = yield* Effect.forkChild(read);
        yield* Effect.yieldNow;
        world.steps.push({ ...step([]), quota });
        world.steps.push(step([Message.assistant('Done.')]));
        yield* recorder.stop();
        return [yield* Fiber.join(left), yield* Fiber.join(right)] as const;
      });
      const numbers = (read: readonly ThreadStepFinished[]) => read.map((finished) => finished.stepNumber);
      expect(numbers(first)).toEqual([0, 1]);
      expect(numbers(second)).toEqual([0, 1]);
      expect(first[0]?.step.quota).toBe(quota);
      expect(first[0]?.run.id).toBe('run-1');
    }),
  );
  it.live(
    'a step that replays nothing still lands as a step-finished fact',
    Effect.fnUntraced(function* () {
      const world = yield* recorderWorld();
      const recorder = yield* world.recorder();
      world.steps.push(step([]));
      yield* recorder.stop();
      expect(world.events.map((event) => event.kind)).toEqual(['step-finished']);
      const finished = world.events.find((event) => event.kind === 'step-finished');
      expect(finished?.payload).toMatchObject({ context: { runId: 'run-1', stepNumber: 0, provider: 'anthropic' } });
      expect(world.transcript()).toEqual([]);
      expect(world.history()).toEqual([]);
    }),
  );
});
type RecorderWorldInput = {
  readonly transcript?: ThreadTranscript;
  readonly stepsTaken?: number;
};
type RecorderState = {
  kinds: ThreadEntryReader;
  refuseRetention: boolean;
  retainAbove: number;
  commitGate: Deferred.Deferred<void> | null;
  readonly commitStarted: Deferred.Deferred<void>;
  tail: ThreadTranscript | null;
  contextWindow: number | null;
  progress: ThreadRunProgress | null;
};
const recorderWorld = Effect.fnUntraced(function* ({ transcript: initialTranscript = [], stepsTaken = 0 }: RecorderWorldInput = {}) {
  const live = yield* makeThreadLiveFeed<ThreadStateShape>();
  const stepHub = yield* Effect.acquireRelease(PubSub.unbounded<ThreadStepFinished>(), PubSub.shutdown);
  const events: ThreadEventInsert[] = [];
  const committed: (readonly Message[])[] = [];
  const committedEntries: ThreadTranscriptEntry[] = [];
  const steps: AgentStep[] = [];
  const landed: RunRequest[] = [];
  const feedEvents: ThreadLiveEvent<ThreadStateShape>[] = [];
  const store = makeAggregateStorage({ transcript: initialTranscript });
  const state: RecorderState = {
    kinds: makeThreadEntryReader({ products: [] }),
    refuseRetention: false,
    retainAbove: Number.POSITIVE_INFINITY,
    commitGate: null,
    commitStarted: yield* Deferred.make<void>(),
    tail: null,
    contextWindow: null,
    progress: null,
  };
  let publishedThrough = 0;
  live.subscribe('thread-1', (event) => feedEvents.push(event));
  const reader = (): FeedView<object> => {
    const reading = new FeedView<object>();
    reading.take({
      type: 'snapshot',
      at: live.view('thread-1').at,
      payload: { status: 'loaded', snapshot: { transcript: store.transcript, before: null, open: [], progress: null } },
    });
    live.subscribe('thread-1', (event) => {
      reading.take(
        event.type === 'open'
          ? { type: 'open', at: event.at, change: event.change }
          : { type: 'state', at: event.at, payload: { records: event.frame.deltas, snapshot: {} } },
      );
    });
    return reading;
  };
  const published = Effect.sync(() => {
    const deltas = events.slice(publishedThrough).map((event, offset) => ({
      position: publishedThrough + offset + 1,
      kind: event.kind,
      entry: event.payload.entry === undefined ? undefined : (event.payload.entry as ThreadTranscriptEntry),
    }));
    const from = publishedThrough;
    publishedThrough = events.length;
    live.publishState({
      state: {
        thread: { id: 'thread-1' },
        position: events.length,
        activeRun: { id: 'run-1', progress: { stage: 'streaming' } },
        latestRun: { id: 'run-1' },
      },
      from,
      deltas,
    });
  });
  const unused = () => Effect.die('The recorder did not request this operation.');
  const eventLog = ThreadEventJournal.of({
    append: (event) =>
      Effect.sync(() => {
        events.push(event);
        return { ...event, position: events.length };
      }),
    eventsAfter: unused,
    recordsAsOf: unused,
    revisionsAsOf: unused,
    positionOf: unused,
    headPosition: () => Effect.sync(() => events.length),
  });
  const accounting = ThreadRunAccounting.of({
    progress: unused,
    usage: unused,
    spentBySpawnRoot: unused,
    progressIn: (_runId, progress) =>
      Effect.sync(() => {
        state.progress = progress;
      }),
    streamTailIn: (_runId, tail) =>
      Effect.sync(() => {
        state.tail = tail;
      }),
    usageIn: unused,
    chargeIn: unused,
  });
  const toolOutputs: ThreadToolOutputScopeFaces = {
    tools: {},
    project: ({ output, modelOutput }) => Effect.succeed({ output, modelOutput }),
    projectMessages: (messages) => Effect.succeed(messages),
    retainInterrupted: ({ toolCallId, text, complete }) =>
      state.refuseRetention
        ? Effect.fail(new ThreadStorageFailed({ call: 'retainInterrupted', cause: `no room for ${toolCallId}` }))
        : Effect.succeed(
            text.length > state.retainAbove
              ? { kind: 'retained', outputId: `kept-${toolCallId}`, byteLength: text.length, complete }
              : { kind: 'text', text, complete },
          ),
    retainOpen: ({ toolCallId, text }) =>
      state.refuseRetention
        ? Effect.fail(new ThreadStorageFailed({ call: 'retainOpen', cause: `no room for ${toolCallId}` }))
        : Effect.succeed({
            input:
              text.length > state.retainAbove
                ? { kind: 'retained', outputId: `kept-${toolCallId}`, byteLength: text.length, complete: false }
                : { kind: 'text', text, complete: false },
            chars: text.length,
          }),
    commitReferenced: Effect.fnUntraced(function* (messages, entries) {
      committed.push(messages);
      committedEntries.push(...entries);
      if (state.commitGate) {
        yield* Deferred.succeed(state.commitStarted, undefined);
        yield* Deferred.await(state.commitGate);
      }
    }),
    dispose: () => Effect.void,
  };
  const recorder = Effect.fnUntraced(function* () {
    const ports = Layer.mergeAll(
      threadFeedLayer(live, (state) => Effect.succeed(state)),
      threadRunSequencesLayer.pipe(Layer.provide(Layer.succeed(ThreadTransitions, store))),
      Layer.succeed(ThreadStore, store),
      Layer.succeed(ThreadEventJournal, eventLog),
      Layer.succeed(ThreadTransitions, store),
      Layer.succeed(ThreadJournalLane, writerOrderedLane),
      Layer.succeed(ThreadEntryKinds, state.kinds),
      Layer.succeed(ThreadStepObserver, stepHub),
      Layer.succeed(ThreadStreamRhythm, { flushIntervalMs: 0 }),
      Layer.succeed(ThreadRunAccounting, accounting),
      Layer.succeed(
        RunRequests,
        RunRequests.of({
          land: (_run, request) => Effect.succeed({ events: [], write: () => Effect.sync(() => void landed.push(request)) }),
          landed: Stream.empty,
        }),
      ),
      Layer.succeed(
        RunProgress,
        RunProgress.of({ enter: () => Effect.void, estimate: () => Effect.void, written: () => Effect.void, end: () => Effect.void }),
      ),
      Layer.succeed(
        ThreadSnapshots,
        ThreadSnapshots.of({
          state: unused,
          snapshot: unused,
          attachFrom: unused,
          page: unused,
          statuses: unused,
          publish: () => published,
          forget: unused,
        }),
      ),
      Layer.succeed(
        ThreadRunLedger,
        ThreadRunLedger.of({
          runById: unused,
          isRunning: unused,
          runningHere: unused,
          activeRun: unused,
          activeRunIn: unused,
          runningOf: unused,
          runsOf: unused,
          latestRuns: unused,
          reapable: unused,
          latestRun: () => Effect.sync(() => ({ ...run(), streamTail: state.tail })),
        }),
      ),
    );
    const context = yield* Layer.build(ports);
    const make = yield* Effect.provide(makeThreadStreamRecorders, context);
    return yield* make({
      threadId: 'thread-1',
      run: run(),
      transcript: initialTranscript,
      stepsTaken,
      steps: () => steps,
      toolOutputs,
      contextWindow: () => state.contextWindow,
    });
  });
  const initialIds = new Set(initialTranscript.map((entry) => entry.id));
  return Object.assign(state, {
    events,
    committed,
    committedEntries,
    steps,
    landed,
    store,
    stepHub,
    feedEvents,
    reader,
    recorder,
    transcript: (): ThreadTranscript => store.transcript.filter((entry) => !initialIds.has(entry.id)),
    history: (): readonly Message[] => store.history,
  });
});
function run(): ThreadRunRow {
  const timestamp = new Date('2026-06-19T12:00:00.000Z');
  return {
    id: 'run-1',
    threadId: 'thread-1',
    kind: 'turn',
    origin: 'core',
    status: 'running',
    ownerId: 'owner-1',
    account: null,
    provider: 'anthropic',
    model: null,
    reasoning: null,
    switches: {},
    resumes: 0,
    settledNotifyAttempts: 0,
    approvalMode: 'trust',
    interactive: true,
    progress: { stage: 'streaming', message: 'Streaming.' },
    usage: null,
    cost: null,
    streamTail: null,
    failureReason: null,
    failure: null,
    createdAt: timestamp,
    startedAt: timestamp,
    heartbeatAt: timestamp,
    handedOverAt: null,
    finishedAt: null,
    settledNotifiedAt: null,
    settledBy: null,
    stopRequest: null,
    withdrawnWords: null,
    settledNotification: null,
    updatedAt: timestamp,
  };
}
function step(messages: readonly Message[], usage = new Usage({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })): AgentStep {
  return {
    content: [],
    text: '',
    reasoningText: undefined,
    toolCalls: [],
    toolResults: [],
    usage,
    response: { messages: [...messages] },
  };
}
function guidanceFrame(id: string, stepNumber: number): AgentRuntimeGuidance {
  return {
    type: 'runtime-guidance',
    id,
    runId: 'run-1',
    hook: 'afterTool',
    sequence: 1,
    texts: ['Use the tool result.'],
    sources: [{ hook: 'afterTool', toolName: 'make_task', toolCallId: 'call-0' }],
    stepNumber,
  };
}
