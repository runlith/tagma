import { Cause, Clock, Deferred, Effect, Exit, PubSub, Result } from 'effect';
import type { CallHooks } from '../../agent/AgentCalls';
import { agentToolRefusal } from '../../agent/AgentFailure';
import { doorToolOutcome } from '../../agent/door/types';
import type { AgentEvent } from '../../agent/AgentEvent';
import type { AgentRuntimeGuidance } from '../../agent/contracts';
import type { AgentStep, AgentStepIntent } from '../../agent/AgentStep';
import { readPartialJsonState } from '@runlith/utils/json';
import { retryEntryId, toolEntryId } from '../../transcript/entryNames';
import { THREAD_TRANSCRIPT_PART, THREAD_RUNTIME_GUIDANCE_PART } from '../../transcript/parts';
import type { ThreadRunRow } from '../rows';
import type { ThreadTranscript, ThreadTranscriptEntry } from '../../transcript/rows';
import { sealThreadEvents } from '../ThreadEventDoor';
import { answerOf, transitionNow, type TransitionDeps } from '../transition/kernel';
import { actDigest } from '../keyed';
import type { Decision } from '../transition/port';
import { runTransition, ThreadRunSequences } from '../transition/sequence';
import { threadFailureMessage } from '../ThreadFailure';
import {
  ThreadFeed,
  ThreadStore,
  ThreadEventJournal,
  ThreadTransitions,
  ThreadStreamRhythm,
  type ThreadToolOutputScopeFaces,
  type ThreadTx,
  type ThreadWriteTx,
} from '../ThreadPorts';
import { ThreadStepObserver, type ThreadStepFinished } from '../ThreadStepObserver';
import { ThreadCallBroke, type ThreadBorderFailed, threadCall } from '../ThreadBorder';
import { ThreadFactQueue, type ThreadRecordedFact } from './ThreadFactQueue';
import { makeThreadFlushWindow } from './ThreadFlushWindow';
import { ThreadGuidanceRecord } from './ThreadGuidanceRecord';
import { ThreadMeasurementRecords } from './ThreadMeasurementRecords';
import { RunProgress } from './RunProgress';
import { ThreadEntryKinds, ThreadEntryUndecodable, coreEntry, coreKind, generatedEntry } from '../../transcript/kinds';
import { ThreadRunAccounting } from './ThreadRunAccounting';
import { RunRequests } from './requests';
import { ThreadStepRecords } from './ThreadStepRecords';
import { makeThreadInterruptions } from './ThreadInterruptions';
import { ThreadStreamParts } from './ThreadStreamParts';
import { settledToolEntry, ThreadToolRecords } from './ThreadToolRecords';
import { threadEntryEvent, threadGuidanceEvent, threadStepMessagesEvent, type ThreadEventBody } from '../events';
import {
  toolResultOutcome,
  toolSettled,
  type ThreadInterruptedInput,
  type ThreadRetryEntry,
  type ThreadToolEntry,
} from '../../transcript/entries';
import type { ToolOutcome } from '../../agent/tool';
import type { ThreadPartGrowth } from './ThreadStreamParts';
import { ThreadJournalLane } from '../transition/lane';
import { ThreadSnapshots } from './ThreadSnapshots';
import { settledLate } from './lateSettlement';
export type ThreadStreamRecorder = Effect.Success<ReturnType<Effect.Success<typeof makeThreadStreamRecorders>>>;
export type ThreadStreamInput = {
  readonly threadId: string;
  readonly run: ThreadRunRow;
  readonly transcript: ThreadTranscript;
  readonly stepsTaken: number;
  readonly steps: () => readonly AgentStep[];
  readonly toolOutputs: ThreadToolOutputScopeFaces;
  readonly contextWindow: () => number | null;
  readonly inputLimit?: () => number | null;
};
export const makeThreadStreamRecorders = Effect.gen(function* () {
  const feed = yield* ThreadFeed;
  const accounting = yield* ThreadRunAccounting;
  const requests = yield* RunRequests;
  const progress = yield* RunProgress;
  const sequences = yield* ThreadRunSequences;
  const stepObserver = yield* ThreadStepObserver;
  const rhythm = yield* ThreadStreamRhythm;
  const snapshots = yield* ThreadSnapshots;
  const makeInterruptions = yield* makeThreadInterruptions;
  const clock = yield* Clock.Clock;
  const kernel: TransitionDeps<ThreadTx, ThreadWriteTx> = {
    store: yield* ThreadStore,
    log: yield* ThreadEventJournal,
    transitions: yield* ThreadTransitions,
    lane: yield* ThreadJournalLane,
    kinds: yield* ThreadEntryKinds,
  };
  return Effect.fnUntraced(function* (deps: ThreadStreamInput) {
    const { threadId, run, steps, toolOutputs } = deps;
    const published = snapshots.publish(threadId);
    const interruptions = yield* makeInterruptions({ threadId, runId: run.id });
    const queue = new ThreadFactQueue();
    const receipts = new Map<string, Deferred.Deferred<void, ThreadBorderFailed>>();
    const recorded = (facts: readonly ThreadRecordedFact[]): void => {
      if (receipts.size === 0) return;
      for (const fact of facts) {
        if (fact.kind !== 'tool-settled') continue;
        const waiting = receipts.get(fact.entry.toolCallId);
        if (waiting === undefined) continue;
        receipts.delete(fact.entry.toolCallId);
        Deferred.doneUnsafe(waiting, Effect.void);
      }
    };
    const measurementRecords = new ThreadMeasurementRecords();
    let tailWritten = false;
    let streaming = false;
    const runEntries = deps.transcript.filter((entry) => entry.runId === run.id);
    const parts = new ThreadStreamParts(run.id, queue, runEntries);
    const tools = new ThreadToolRecords(run.id, queue, runEntries);
    const stepRecords = new ThreadStepRecords(run, deps.stepsTaken, deps.contextWindow, deps.inputLimit ?? (() => null));
    const guidanceRecord = new ThreadGuidanceRecord(runEntries);
    const window = yield* makeThreadFlushWindow({ intervalMs: rhythm.flushIntervalMs, reportFailure: (failure) => warn(failure) });
    const push = (chunk: AgentEvent): Effect.Effect<void, ThreadBorderFailed> => {
      return window.record(
        Effect.gen(function* () {
          if (window.stopped) return;
          if (chunk.type === 'phase') {
            yield* progress.enter(run, chunk.phase);
            if (!streaming) yield* window.schedule(() => flush());
            return;
          }
          if (chunk.type === 'context-estimate') {
            stepRecords.estimated(chunk.stepNumber, chunk.contextWindow);
            return yield* progress.estimate(run, {
              stepNumber: chunk.stepNumber,
              tokens: chunk.tokens,
              contextWindow: chunk.contextWindow,
            });
          }
          if (chunk.type === 'step-start') yield* window.flush(flush());
          const consumed = consume(chunk);
          if (consumed instanceof ThreadEntryUndecodable) return yield* new ThreadCallBroke({ cause: consumed });
          if (consumed === 'shape' || (consumed !== 'quiet' && consumed.opened)) {
            feed.tail(threadId, run.id, openTail(), []);
          } else if (consumed !== 'quiet') feed.append(threadId, run.id, consumed.id, consumed.text);
          yield* window.schedule(() => flush());
        }),
      );
    };
    const openTail = (retained: ReadonlyMap<string, ThreadInterruptedInput> = new Map()): readonly ThreadTranscriptEntry[] => {
      return [...queue.held(0), ...parts.tail((toolCallId) => tools.displayOf(toolCallId), retained)];
    };
    const commitStepIntent = (intent: AgentStepIntent): Effect.Effect<void, ThreadBorderFailed> => {
      return Effect.suspend(() =>
        window.stopped
          ? Effect.die(new Error('The stream recorder is stopped.'))
          : window.serialize(Effect.flatMap(feed.atCut(threadId, writeIntent(intent)), (moved) => (moved ? published : Effect.void))),
      );
    };
    const flushRecorded = (): Effect.Effect<void, ThreadBorderFailed> => {
      return Effect.suspend(() => (window.stopped ? Effect.void : window.serialize(flush())));
    };
    const interruptedRecorded = Effect.fn('ThreadStreamRecorder.interruptedRecorded')(function* (
      toolCallIds: readonly string[],
    ): Effect.fn.Return<ReadonlyMap<string, ThreadInterruptedInput>, ThreadBorderFailed> {
      if (!window.stopped) yield* window.serialize(flush());
      return yield* interruptions.settled(toolCallIds);
    });
    const completed = Effect.fn('ThreadStreamRecorder.completed')(function* (
      call: Parameters<CallHooks['completed']>[0],
      exit: Parameters<CallHooks['completed']>[1],
    ): Effect.fn.Return<void, ThreadBorderFailed> {
      const id = toolEntryId(call.toolCallId);
      const waiting = yield* window.record(
        Effect.gen(function* () {
          if (!window.stopped) yield* flush();
          const entry = yield* kernel.store.entryById(threadId, id);
          if (entry !== undefined && coreEntry(entry) && entry.type === 'tool' && toolSettled(entry.toolState)) return null;
          const waiting = Deferred.makeUnsafe<void, ThreadBorderFailed>();
          receipts.set(call.toolCallId, waiting);
          return waiting;
        }),
      );
      if (waiting !== null) yield* Deferred.await(waiting);
      yield* settledLate(kernel, feed, toolOutputs, threadId, run.id, call, exit);
      yield* published;
    });
    const stop = (): Effect.Effect<void, ThreadBorderFailed> => {
      return window
        .close(() => finalFlush())
        .pipe(
          Effect.tapError((failure) =>
            Effect.sync(() => {
              for (const waiting of receipts.values()) Deferred.doneUnsafe(waiting, Effect.fail(failure));
              receipts.clear();
            }),
          ),
          Effect.ensuring(Effect.sync(() => interruptions.close())),
        );
    };
    const finalFlush = Effect.fnUntraced(function* (): Effect.fn.Return<void, ThreadBorderFailed> {
      for (const open of parts.openToolInputs()) {
        tools.interruptedInput({
          toolCallId: open.toolCallId,
          toolName: open.toolName,
          received: { kind: 'text', text: open.inputText, complete: false },
        });
        parts.dropToolInput(open.toolCallId);
      }
      yield* flush();
      feed.tail(
        threadId,
        run.id,
        [],
        openTail().map((entry) => entry.id),
      );
    });
    const warn = (error: unknown): Effect.Effect<void> => {
      return Effect.logWarning('thread stream recording failed', {
        threadId: threadId,
        runId: run.id,
        error: threadFailureMessage(error),
      });
    };
    const consume = (chunk: AgentEvent): ThreadPartGrowth | ThreadEntryUndecodable | 'quiet' | 'shape' => {
      switch (chunk.type) {
        case 'text-start':
          parts.start('text', chunk.id);
          return 'quiet';
        case 'text-delta':
          return parts.append('text', chunk.id, chunk.text) ?? 'quiet';
        case 'text-end':
          parts.close('text', chunk.id);
          return 'shape';
        case 'reasoning-start':
          parts.start('reasoning', chunk.id);
          return 'quiet';
        case 'reasoning-delta':
          return parts.append('reasoning', chunk.id, chunk.text) ?? 'quiet';
        case 'reasoning-end':
          parts.close('reasoning', chunk.id);
          return 'shape';
        case 'step-finish':
          parts.closeAtStep();
          stepRecords.finished(chunk.index, chunk.usage);
          return 'shape';
        case 'input-usage':
          stepRecords.promptCounted(chunk.inputUsage.inputTokens);
          return 'quiet';
        case 'measurement':
          measurementRecords.measured(chunk.measurement);
          return 'quiet';
        case 'retry': {
          const entry: ThreadRetryEntry = {
            type: 'retry',
            id: retryEntryId(run.id, chunk.stepNumber, chunk.attempt),
            runId: run.id,
            stepNumber: chunk.stepNumber,
            attempt: chunk.attempt,
            of: chunk.of,
            family: chunk.family,
            delayMs: chunk.delayMs,
            message: chunk.message,
            reason: chunk.reason,
            occurredAt: new Date(clock.currentTimeMillisUnsafe()).toISOString(),
          };
          stepRecords.retried(chunk.stepNumber, chunk.attempt);
          queue.push({ kind: 'entry', entry });
          return 'shape';
        }
        case 'tool-input-start':
          if (tools.isKnown(chunk.id)) return 'quiet';
          parts.startToolInput(chunk.id, chunk.name);
          return 'shape';
        case 'tool-input-delta': {
          const growth = parts.appendToolInput(chunk.id, chunk.name, chunk.text);
          return growth === null ? 'quiet' : growth.opened ? 'shape' : growth;
        }
        case 'tool-input-interrupted': {
          const open = parts.dropToolInput(chunk.toolCallId);
          const text = open?.inputText ?? '';
          tools.interruptedInput({
            toolCallId: chunk.toolCallId,
            toolName: open?.toolName ?? chunk.toolName,
            received: { kind: 'text', text, complete: readPartialJsonState(text)?.complete ?? false },
            stepNumber: chunk.stepNumber,
            attempt: chunk.attempt,
            cause: chunk.cause,
          });
          return 'shape';
        }
        case 'tool-call':
          parts.dropToolInput(chunk.id);
          tools.announce(chunk.id, chunk.name, chunk.input);
          return 'shape';
        case 'tool-result':
          settle(chunk.id, chunk.name, toolResultOutcome(chunk.result));
          return 'shape';
        case 'tool-error':
          settle(chunk.id, chunk.name, { kind: 'failed', error: chunk.message });
          return 'shape';
        case 'tool-outcome':
          settle(chunk.toolCallId, chunk.toolName, chunk.outcome);
          return 'shape';
        case 'tool-display':
          tools.display(chunk.toolCallId, chunk.display);
          return 'shape';
        case 'tool-execution':
          tools.execution(chunk.toolCallId, chunk.admission);
          return 'shape';
        default: {
          const consumed = consumeDataPart(chunk);
          return consumed instanceof ThreadEntryUndecodable ? consumed : consumed ? 'shape' : 'quiet';
        }
      }
    };
    const settle = (toolCallId: string, toolName: string, outcome: ToolOutcome): void => {
      const open = parts.dropToolInput(toolCallId);
      tools.settle({ toolCallId, toolName, openToolName: open?.toolName, outcome });
    };
    const consumeDataPart = (chunk: AgentEvent): boolean | ThreadEntryUndecodable => {
      if (chunk.type === `data-${THREAD_RUNTIME_GUIDANCE_PART}`) {
        guidanceRecord.push(
          (
            chunk as {
              data: AgentRuntimeGuidance;
            }
          ).data,
        );
        return false;
      }
      if (chunk.type !== `data-${THREAD_TRANSCRIPT_PART}`) return false;
      if ('transient' in chunk && chunk.transient === true) return false;
      const data = (
        chunk as {
          readonly data: unknown;
        }
      ).data;
      const type =
        typeof data === 'object' && data !== null
          ? (
              data as {
                readonly type?: unknown;
              }
            ).type
          : undefined;
      if (typeof type === 'string' && coreKind(type)) return false;
      const decoded = kernel.kinds.decode(data);
      if (Result.isFailure(decoded)) return decoded.failure;
      queue.push({ kind: 'entry', entry: decoded.success });
      return true;
    };
    const writeIntent = Effect.fn('ThreadStreamRecorder.writeIntent')(function* (
      intent: AgentStepIntent,
    ): Effect.fn.Return<boolean, ThreadBorderFailed> {
      const occurredAt = new Date(clock.currentTimeMillisUnsafe()).toISOString();
      const events: ThreadEventBody[] = [];
      const { facts, count: factCount } = queue.batch(true);
      const provisioned = new Set(intent.calls.map((call) => toolEntryId(call.toolCallId)));
      const landing = facts.filter((fact) => !(fact.entry.type === 'tool' && provisioned.has(fact.entry.id)));
      const takenGuidance = guidanceRecord.upTo(intent.stepNumber);
      for (const frame of takenGuidance) events.push(threadGuidanceEvent(frame));
      events.push(...(yield* entryEvents(landing)));
      const stepEvent = threadStepMessagesEvent(intent.messages, {
        context: stepRecords.contextOf(intent.stepNumber),
      });
      if (stepEvent) events.push(stepEvent);
      const { entries, taken } = tools.provision(intent.calls, occurredAt);
      for (const entry of entries) events.push(threadEntryEvent(entry));
      if (events.length === 0) return false;
      const declared = sealThreadEvents(events);
      return yield* Effect.uninterruptible(
        runTransition<undefined, ThreadWriteTx>(
          kernel,
          sequences,
          run,
          {
            declared,
            decide: () =>
              Effect.succeed({
                apply: true,
                result: undefined,
                participants: (tx: ThreadWriteTx) =>
                  accounting.progressIn(
                    run.id,
                    { stage: 'streaming', message: null },
                    tx,
                    stepEvent !== null || entries.length > 0 || landing.some(isGeneratedFact),
                  ),
              } as const),
          },
          ['intent', intent.stepNumber, declared.map((event) => event.id)],
        ).pipe(
          Effect.flatMap((outcome) => answerOf(threadId, outcome)),
          Effect.tap(() =>
            Effect.sync(() => {
              stepRecords.intentCommitted(intent.stepNumber);
              queue.take(factCount);
              recorded(landing);
              guidanceRecord.take(takenGuidance);
              tools.provisioned(taken);
              feed.tail(threadId, run.id, openTail(), landedIds(declared));
            }),
          ),
          Effect.as(true),
        ),
      );
    });
    const entryEvents = (facts: readonly ThreadRecordedFact[]): Effect.Effect<ThreadEventBody[], ThreadBorderFailed> => {
      return Effect.succeed(facts.map((fact) => threadEntryEvent(fact.entry)));
    };
    const retainInterruptedInputs = Effect.fn('ThreadStreamRecorder.retainInterruptedInputs')(function* (): Effect.fn.Return<{
      readonly resolved: ReadonlyMap<string, ThreadInterruptedInput>;
      readonly original: ReadonlyMap<string, ThreadToolEntry>;
    }> {
      const resolved = new Map<string, ThreadInterruptedInput>();
      const original = new Map<string, ThreadToolEntry>();
      for (const entry of queue.interrupted()) {
        const held = entry.toolInputRaw;
        if (held?.kind !== 'text') continue;
        const retained = yield* Effect.result(
          toolOutputs.retainInterrupted({
            toolCallId: entry.toolCallId,
            toolName: entry.toolName,
            text: held.text,
            complete: held.complete,
          }),
        );
        if (retained._tag === 'Failure') yield* warn(retained.failure);
        const kept: ThreadInterruptedInput =
          retained._tag === 'Success'
            ? retained.success
            : {
                kind: 'unavailable',
                reason: threadFailureMessage(retained.failure),
                byteLength: new TextEncoder().encode(held.text).byteLength,
                complete: held.complete,
              };
        original.set(entry.toolCallId, entry);
        queue.replaceTool({ ...entry, toolInputRaw: kept });
        resolved.set(entry.toolCallId, kept);
      }
      return { resolved, original };
    });
    const retainOpenInputs = Effect.fn('ThreadStreamRecorder.retainOpenInputs')(function* (): Effect.fn.Return<
      ReadonlyMap<string, ThreadInterruptedInput>
    > {
      const retained = new Map<string, ThreadInterruptedInput>();
      for (const open of parts.openToolInputs()) {
        if (open.inputText.length === 0) continue;
        const retainedInput = yield* Effect.result(
          toolOutputs.retainOpen({
            toolCallId: open.toolCallId,
            toolName: open.toolName,
            text: open.inputText,
            held: open.held,
          }),
        );
        parts.holdToolInput(open.toolCallId, retainedInput._tag === 'Success' ? retainedInput.success : null);
        const kept: ThreadInterruptedInput =
          retainedInput._tag === 'Success'
            ? retainedInput.success.input
            : {
                kind: 'unavailable',
                reason: threadFailureMessage(retainedInput.failure),
                byteLength: new TextEncoder().encode(open.inputText).byteLength,
                complete: false,
              };
        retained.set(open.toolCallId, kept);
      }
      return retained;
    });
    const flush = (): Effect.Effect<void, ThreadBorderFailed> => {
      return Effect.flatMap(feed.atCut(threadId, flushed()), (moved) => (moved ? published : Effect.void));
    };
    const flushed = Effect.fn('ThreadStreamRecorder.flush')(function* (): Effect.fn.Return<boolean, ThreadBorderFailed> {
      const interrupted = yield* retainInterruptedInputs();
      const openInputs = yield* retainOpenInputs();
      const stepStart = stepRecords.startsAt();
      const newSteps = stepRecords.pending(steps());
      const { facts, count: factCount } = queue.batch(newSteps.length > 0);
      const guidance = guidanceRecord.unseen();
      const held: ThreadTranscriptEntry[] = [
        ...queue.held(factCount),
        ...parts.tail((toolCallId) => tools.displayOf(toolCallId), openInputs),
      ];
      const tail = held.length > 0 ? held : null;
      const measurements = measurementRecords.pending();
      const batch = stepRecords.events(newSteps, guidance);
      if (
        facts.length === 0 &&
        newSteps.length === 0 &&
        guidance.length === 0 &&
        measurements.length === 0 &&
        batch.requests.length === 0 &&
        tail === null &&
        !tailWritten &&
        streaming
      ) {
        return false;
      }
      const landings = yield* Effect.forEach(batch.requests, (request) => requests.land(run, request));
      const events: ThreadEventBody[] = [
        ...(yield* entryEvents(facts)),
        ...measurements,
        ...batch.events,
        ...landings.flatMap((landing) => landing.events),
      ];
      const stepMessages = batch.stepMessages;
      const declared = sealThreadEvents(events);
      yield* Effect.uninterruptible(
        Effect.tap(
          Effect.flatMap(
            runTransition<undefined, ThreadWriteTx>(
              kernel,
              sequences,
              run,
              {
                declared,
                decide: () =>
                  Effect.succeed<Decision<undefined, ThreadWriteTx>>({
                    apply: true,
                    result: undefined,
                    participants: Effect.fnUntraced(function* (tx) {
                      const recorded = [...facts.map((fact) => fact.entry), ...held];
                      if (stepMessages.length > 0 || recorded.length > 0) {
                        yield* toolOutputs.commitReferenced(stepMessages, recorded, tx);
                      }
                      for (const landing of landings) yield* landing.write(tx);
                      const durable = facts.some(isGeneratedFact) || newSteps.length > 0 || landings.length > 0;
                      if (durable || !streaming) yield* accounting.progressIn(run.id, { stage: 'streaming', message: null }, tx, durable);
                      yield* progress.written(run, tx);
                      yield* accounting.streamTailIn(run.id, tail, tx);
                    }),
                  }),
              },
              ['flush', declared.map((event) => event.id), tail?.map((entry) => entry.id) ?? null],
            ),
            (outcome) => answerOf(threadId, outcome),
          ),
          () =>
            Effect.sync(() => {
              streaming = true;
              queue.take(factCount);
              recorded(facts);
              measurementRecords.take(measurements.length);
              stepRecords.landed(batch.requests);
              stepRecords.appendedSteps(newSteps.length);
              guidanceRecord.take(guidance);
              if (newSteps.length > 0) guidanceRecord.committedThrough(stepStart + newSteps.length - 1);
              tailWritten = tail !== null;
              if (newSteps.length > 0 && parts.idle()) tools.committedStep();
              for (const toolCallId of interrupted.resolved.keys()) interruptions.took(toolCallId);
              feed.tail(threadId, run.id, held, landedIds(declared));
            }),
        ),
      ).pipe(
        Effect.tapError((failure) =>
          Effect.sync(() => {
            for (const entry of interrupted.original.values()) queue.replaceTool(entry);
            interruptions.failed(failure);
          }),
        ),
      );
      for (let offset = 0; offset < newSteps.length; offset += 1) {
        const step = newSteps[offset];
        if (step) yield* PubSub.publish(stepObserver, { run: run, stepNumber: stepStart + offset, step });
      }
      return true;
    });
    return { push, commitStepIntent, flushRecorded, interruptedRecorded, completed, stop };
  });
});
function landedIds(
  declared: readonly {
    readonly body: ThreadEventBody;
  }[],
): readonly string[] {
  return declared.flatMap(({ body }) => (body.payload.entry === undefined ? [] : [body.payload.entry.id]));
}
function isGeneratedFact({ entry }: ThreadRecordedFact): boolean {
  return generatedEntry(entry);
}
