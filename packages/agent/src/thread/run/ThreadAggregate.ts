import { ThreadJournalLane } from '../transition/lane';
import { ThreadEntryKinds, coreEntry } from '../../transcript/kinds';
import type { ThreadBornOf } from '../../protocol/birth';
import type { ModelSwitches } from '@runlith/llm/models/description';
import { Clock, Data, Context, Duration, Effect, Fiber, Layer } from 'effect';
import type { ThreadAttachmentRef } from '../../transcript/attachments';
import type { ThreadInteractionAnswer, ThreadRestartEntry } from '../../transcript/entries';
import { ThreadRunConflictError, ThreadRunNotInterruptedError } from '../storage/runs';
import { unsettledEffects } from './ThreadEffectSettlement';
import type { FeedPosition, ThreadResumeOf, ThreadSnapshotOf } from '../../transcript/live';
import type { ThreadSnapshot, ThreadState, ThreadStateProject } from '../state';
import { ATTACHED_CONTEXT_SIGNAL_TYPE, type ThreadSignal } from '../../transcript/parts';
import { isReaderWordsItem } from '../inboxItems';
import type { ThreadInboxItem } from '../storage/inbox';
import { threadRunLimited, type ThreadAuthority, type ThreadMetadataRow, type ThreadRow, type ThreadRunRow } from '../rows';
import type { ThreadInsertValues } from '../storage/aggregate';
import type { ThreadTranscriptPage } from '../../transcript/rows';
import type { AgentApprovalMode, ThreadBindings } from '../../agent/contracts';
import { sealThreadEvents } from '../ThreadEventDoor';
import { actDigest, callKey, type CallerKey, type Keyed } from '../keyed';
import { answerOf, controlIfPresent, TRANSITION_PATIENCE_MS, transitionNow } from '../transition/kernel';
import type { Decision } from '../transition/port';
import { mintThreadEventId, mintThreadSignalId } from '../identity';
import { threadSignalEvent, type ThreadEventInput } from '../events';
import type { ThreadDefinition, ThreadProfileBirth } from '../agents/AgentProfile';
import { ThreadAgents } from '../agents/ThreadAgents';
import type { ThreadCompactAsk } from './ThreadCompactionRuns';
import { ThreadModes } from './ThreadModes';
import { Questions } from './Questions';
import { ThreadInteractionConflictError } from './ThreadQuestion';
import {
  ThreadAttachments,
  ThreadEventJournal,
  ThreadInbox,
  ThreadStore,
  ThreadTransitions,
  type ThreadToolOutputScopeFaces,
  type ThreadTx,
  type ThreadWriteTx,
} from '../ThreadPorts';
import { ThreadCallBroke, type ThreadBorderFailed, type ThreadPortFailure } from '../ThreadBorder';
import { ThreadRunInbox } from './ThreadRunInbox';
import { ThreadDeletion } from './ThreadDeletion';
import { ThreadStopping } from './ThreadStopping';
import { RunAdmission } from './runAdmission';
import type { ThreadRestarted, ThreadStop, ThreadStopOptions } from '../ending';
import { Transports } from '../transport/Transports';
import { ThreadRunLedger } from './ThreadRunLedger';
import { RunAssembly } from './assembly/RunAssembly';
import type { ThreadInstructionsChecked } from './assembly/prompt';
import { RunScheduler } from './scheduler/RunScheduler';
import type { ThreadCompacted } from './scheduler/compactions';
import type { ThreadBegun } from './scheduler/openings';
import type {
  ThreadKeepWarmResult,
  ThreadSaid,
  ThreadSignalBehavior,
  ThreadSignalInput,
  ThreadSignalResult,
  ThreadSteerInput,
} from './scheduler/inputs';
import { ThreadModels, type ThreadModelSettings } from './ThreadModels';
import { ThreadSnapshots } from './ThreadSnapshots';
const RESTART_PATIENCE = Duration.millis(TRANSITION_PATIENCE_MS);
export type ThreadContextAttachment = {
  readonly title: string;
  readonly text: string;
};
export class ThreadContextAttachError extends Data.TaggedError('ThreadContextAttach')<{
  readonly message: string;
}> {
  constructor(message: string) {
    super({ message });
    this.name = 'ThreadContextAttachError';
  }
}
export function attachedContextModelText(title: string, body: string): string {
  return `Document "${title}"\n\n${body}`;
}
export function prepareThreadContextAttachment(input: ThreadContextAttachment): ThreadContextAttachment {
  const title = input.title.trim();
  const source = input.text.trim();
  if (!title) throw new ThreadContextAttachError('Attached context title is empty.');
  if (title.length > 200) throw new ThreadContextAttachError('Attached context title is too long.');
  if (!source) throw new ThreadContextAttachError('Attached context text is empty.');
  return { title, text: source };
}
export type ThreadSayOptions = {
  readonly key?: string;
  readonly inputId?: string;
  readonly admitted?: Keyed;
};
export type ThreadCreateInput = {
  ownerId: string;
  agentId: string;
  profile?: ThreadProfileBirth;
  createdBy?: string | null;
  hostKind?: string | null;
  hostId?: string | null;
  account?: string | null;
  provider?: ThreadInsertValues['provider'];
  model?: string | null;
  reasoning?: string | null;
  switches?: ModelSwitches;
  bindings?: ThreadBindings;
  authority?: ThreadAuthority;
  bornOf?: ThreadBornOf | null;
};
export class ThreadAggregate extends Context.Service<
  ThreadAggregate,
  {
    create<T = ThreadRow>(
      input: ThreadCreateInput,
      commit?: (thread: ThreadRow, tx: ThreadWriteTx) => Effect.Effect<T, ThreadBorderFailed>,
    ): Effect.Effect<T | ThreadRow, ThreadBorderFailed>;
    owned(threadId: string, ownerId: string): Effect.Effect<ThreadRow, ThreadBorderFailed>;
    send(
      thread: ThreadMetadataRow,
      text: string,
      attachments?: readonly ThreadAttachmentRef[],
      options?: ThreadSayOptions,
    ): Effect.Effect<ThreadSaid, ThreadBorderFailed>;
    queue(
      thread: ThreadMetadataRow,
      text: string,
      attachments?: readonly ThreadAttachmentRef[],
      options?: ThreadSayOptions,
    ): Effect.Effect<ThreadSaid, ThreadBorderFailed>;
    begin(
      threadId: string,
      ownerId: string,
      text?: string,
    ): Effect.Effect<
      {
        runId: string;
      },
      ThreadBorderFailed
    >;
    continue(threadId: string, ownerId: string): Effect.Effect<ThreadBegun, ThreadBorderFailed>;
    keepWarm(threadId: string, ownerId: string, signalId: string): Effect.Effect<ThreadKeepWarmResult, ThreadBorderFailed>;
    steer(thread: ThreadMetadataRow, input: ThreadSteerInput, admitted?: Keyed): Effect.Effect<ThreadSaid, ThreadBorderFailed>;
    unqueue(threadId: string, ownerId: string, inputId: string): Effect.Effect<boolean, ThreadBorderFailed>;
    retract(
      threadId: string,
      ownerId: string,
      signalId: string,
      within: (tx: ThreadWriteTx) => Effect.Effect<void, ThreadPortFailure>,
    ): Effect.Effect<boolean, ThreadBorderFailed>;
    compact(threadId: string, ownerId: string, input?: ThreadCompactAsk): Effect.Effect<ThreadCompacted, ThreadBorderFailed>;
    checkInstructions(
      threadId: string,
      ownerId: string,
      definition?: ThreadDefinition,
    ): Effect.Effect<ThreadInstructionsChecked, ThreadBorderFailed>;
    answer(
      threadId: string,
      ownerId: string,
      input: {
        questionId: string;
        answers: readonly ThreadInteractionAnswer[];
        call?: CallerKey;
      },
    ): Effect.Effect<
      {
        runId: string;
      },
      ThreadBorderFailed
    >;
    attachContext(
      threadId: string,
      ownerId: string,
      input: ThreadContextAttachment,
      call?: CallerKey,
    ): Effect.Effect<void, ThreadBorderFailed>;
    append(
      threadId: string,
      ownerId: string,
      events: readonly ThreadEventInput[],
      toolOutputs?: ThreadToolOutputScopeFaces,
      call?: CallerKey,
    ): Effect.Effect<void, ThreadBorderFailed>;
    sendSignal(
      threadId: string,
      ownerId: string,
      input: ThreadSignalInput,
      behavior?: ThreadSignalBehavior,
    ): Effect.Effect<ThreadSignalResult, ThreadBorderFailed>;
    deleteThread(ownerId: string, threadId: string, within?: Duration.Duration): Effect.Effect<boolean, ThreadBorderFailed>;
    deleteByHost(ownerId: string, hostKind: string, hostId: string): Effect.Effect<void, ThreadBorderFailed>;
    snapshot(threadId: string): Effect.Effect<ThreadSnapshot, ThreadBorderFailed>;
    page(threadId: string, before: number): Effect.Effect<ThreadTranscriptPage, ThreadBorderFailed>;
    attachFrom(threadId: string, since: FeedPosition): Effect.Effect<ThreadResumeOf<ThreadState> | null, ThreadBorderFailed>;
    stop(
      threadId: string,
      ownerId: string,
      expectedRunId: string | undefined,
      options: ThreadStopOptions,
    ): Effect.Effect<ThreadStop, ThreadBorderFailed>;
    release(threadId: string, ownerId: string): Effect.Effect<'stopped' | 'not-running', ThreadBorderFailed>;
    restart(threadId: string, ownerId: string, byThreadId?: string): Effect.Effect<ThreadRestarted, ThreadBorderFailed>;
    seat(threadId: string, ownerId: string): Effect.Effect<void, ThreadBorderFailed>;
    setModelSettings<T extends ThreadState>(
      threadId: string,
      ownerId: string,
      settings: ThreadModelSettings,
      project: ThreadStateProject<T>,
    ): Effect.Effect<ThreadSnapshotOf<T>, ThreadBorderFailed>;
    setAuthorityMode<T extends ThreadState>(
      threadId: string,
      ownerId: string,
      mode: AgentApprovalMode,
      project: ThreadStateProject<T>,
    ): Effect.Effect<ThreadSnapshotOf<T>, ThreadBorderFailed>;
  }
>()('@runlith/agent/ThreadAggregate') {}
export const threadAggregateLayer = Layer.effect(
  ThreadAggregate,
  Effect.gen(function* () {
    const agents = yield* ThreadAgents;
    const attachments = yield* ThreadAttachments;
    const modes = yield* ThreadModes;
    const journal = yield* ThreadEventJournal;
    const inbox = yield* ThreadInbox;
    const questions = yield* Questions;
    const deletion = yield* ThreadDeletion;
    const stopping = yield* ThreadStopping;
    const admission = yield* RunAdmission;
    const ledger = yield* ThreadRunLedger;
    const runInbox = yield* ThreadRunInbox;
    const assembly = yield* RunAssembly;
    const scheduler = yield* RunScheduler;
    const models = yield* ThreadModels;
    const snapshots = yield* ThreadSnapshots;
    const store = yield* ThreadStore;
    const transports = yield* Transports;
    const kernel = {
      store,
      log: journal,
      transitions: yield* ThreadTransitions,
      lane: yield* ThreadJournalLane,
      kinds: yield* ThreadEntryKinds,
    };
    const owned = Effect.fnUntraced(function* (threadId: string, ownerId: string): Effect.fn.Return<ThreadRow, ThreadBorderFailed> {
      const thread = yield* store.findOwned(threadId, ownerId);
      if (!thread) return yield* new ThreadCallBroke({ cause: new Error(`Thread not found: ${threadId}.`) });
      return thread;
    });
    const ownedMetadata = Effect.fnUntraced(function* (
      threadId: string,
      ownerId: string,
    ): Effect.fn.Return<ThreadMetadataRow, ThreadBorderFailed> {
      const thread = yield* store.metadata(threadId);
      if (!thread || thread.ownerId !== ownerId) {
        return yield* new ThreadCallBroke({ cause: new Error(`Thread not found: ${threadId}.`) });
      }
      return thread;
    });
    const holdingRun = Effect.fnUntraced(function* (threadId: string): Effect.fn.Return<ThreadRunRow | null, ThreadBorderFailed> {
      const active = yield* ledger.activeRun(threadId);
      if (active) return active;
      return yield* ledger.latestRun(threadId);
    });
    const takeBackQueued = Effect.fnUntraced(function* (
      threadId: string,
      inputId: string,
      options: {
        readonly admits: (item: ThreadInboxItem) => boolean;
        readonly slot: (tx: ThreadWriteTx) => Effect.Effect<boolean, ThreadPortFailure>;
        readonly within?: (tx: ThreadWriteTx) => Effect.Effect<void, ThreadPortFailure>;
      },
    ): Effect.fn.Return<boolean, ThreadBorderFailed> {
      const queued = (tx: ThreadTx) =>
        Effect.map(inbox.pending(threadId, tx), (pending) =>
          pending.find((item) => item.id === inputId && item.state === 'queued' && options.admits(item)),
        );
      const within = options.within;
      const decided = yield* controlIfPresent<boolean, ThreadWriteTx, ThreadPortFailure>(
        kernel,
        threadId,
        {
          decide: Effect.fnUntraced(function* (_row, tx) {
            const waiting = yield* queued(tx);
            const takes = waiting !== undefined && (waiting.kind !== 'signal' || (yield* options.slot(tx)));
            return {
              apply: true,
              result: takes,
              participants: Effect.fnUntraced(function* (unit) {
                if (within !== undefined) yield* within(unit);
                if (takes) yield* inbox.acknowledge([inputId], null, unit);
              }),
            } as Decision<boolean, ThreadWriteTx, ThreadPortFailure>;
          }),
        },
        { evidence: { decidedBy: `take-back:${inputId}` }, digest: actDigest(['take-back', threadId, inputId]) },
      );
      const taken = decided === undefined ? false : yield* answerOf(threadId, decided);
      if (!taken) return false;
      yield* snapshots.publish(threadId);
      return true;
    });
    const say = (mode: 'send' | 'queue') =>
      Effect.fnUntraced(function* (
        thread: ThreadMetadataRow,
        text: string,
        refs: readonly ThreadAttachmentRef[] | undefined,
        options: ThreadSayOptions = {},
      ): Effect.fn.Return<ThreadSaid, ThreadBorderFailed> {
        const trimmed = text.trim();
        if (!trimmed && !refs?.length) return yield* new ThreadCallBroke({ cause: new Error('Message is empty.') });
        yield* agents.get(thread.agentId);
        if (refs?.length) yield* attachments.resolve(thread.id, thread.ownerId, refs);
        const turn = { text: trimmed, inputId: options.inputId || undefined, admitted: options.admitted };
        return yield* scheduler.admit(thread, { kind: 'say', mode, turn, refs: refs });
      });
    const seated = Effect.fnUntraced(function* (thread: ThreadMetadataRow) {
      const transport = yield* Effect.mapError(transports.of(thread), (cause) => new ThreadCallBroke({ cause }));
      if (transport.resource !== undefined) yield* transport.resource.seated(thread.id);
    });
    const appended = Effect.fnUntraced(function* (
      threadId: string,
      ownerId: string,
      events: readonly ThreadEventInput[],
      toolOutputs?: ThreadToolOutputScopeFaces,
      call?: CallerKey,
    ) {
      if (events.length === 0) return;
      const thread = yield* owned(threadId, ownerId);
      const sealed = sealThreadEvents(events);
      yield* Effect.flatMap(
        transitionNow<undefined, ThreadWriteTx>(
          kernel,
          thread.id,
          {
            declared: sealed,
            decide: () =>
              Effect.succeed({
                apply: true,
                result: undefined,
                participants: toolOutputs
                  ? (unit: ThreadWriteTx) =>
                      toolOutputs.commitReferenced(
                        sealed.flatMap(({ body }) => body.payload.messages ?? []),
                        sealed.flatMap(({ body }) => (body.payload.entry ? [body.payload.entry] : [])),
                        unit,
                      )
                  : undefined,
              } as Decision<undefined, ThreadWriteTx>),
          },
          call === undefined
            ? {
                evidence: { decidedBy: `append:${sealed[0]!.id}` },
                digest: actDigest(['append', thread.id, sealed.map((event) => event.id)]),
              }
            : {
                evidence: { call: callKey({ operation: 'append', ...call }) },
                digest: actDigest([
                  'append',
                  thread.id,
                  events.map((event) => ('compose' in event ? { kind: event.kind, payload: event.compose('') } : event)),
                ]),
              },
        ).pipe(Effect.catchTag('ThreadNotFound', (missing) => Effect.fail(new ThreadCallBroke({ cause: missing })))),
        (outcome) => answerOf(thread.id, outcome),
      );
      yield* snapshots.publish(thread.id);
    });
    return ThreadAggregate.of({
      owned,
      create: Effect.fnUntraced(function* (input, commit) {
        if (!(yield* agents.get(input.agentId)).runPolicy.userStartable) {
          return yield* Effect.die(new Error(`Agent ${input.agentId} cannot be started by a user.`));
        }
        const values = {
          ownerId: input.ownerId,
          agentId: input.agentId,
          profile: input.profile,
          createdBy: input.createdBy ?? null,
          hostKind: input.hostKind || undefined,
          hostId: input.hostKind ? (input.hostId ?? null) : undefined,
          account: input.account ?? null,
          provider: input.provider,
          model: input.model ?? null,
          reasoning: input.reasoning ?? null,
          switches: input.switches ?? {},
          bindings: input.bindings,
          authority: input.authority,
          bornOf: input.bornOf ?? null,
        };
        if (!commit) return yield* store.insert(values);
        return yield* store.transaction((tx) => Effect.flatMap(store.insert(values, tx), (row) => commit(row, tx)));
      }),
      send: say('send'),
      queue: say('queue'),
      begin: Effect.fnUntraced(function* (threadId, ownerId, text) {
        const thread = yield* ownedMetadata(threadId, ownerId);
        yield* agents.get(thread.agentId);
        const begun = yield* scheduler.admit(thread, { kind: 'begin', text: text ?? '' });
        return { runId: begun.runId };
      }),
      continue: (threadId, ownerId) =>
        Effect.flatMap(ownedMetadata(threadId, ownerId), (thread) =>
          Effect.andThen(agents.get(thread.agentId), scheduler.admit(thread, { kind: 'continue' })),
        ),
      keepWarm: Effect.fnUntraced(function* (threadId, ownerId, signalId) {
        const thread = yield* owned(threadId, ownerId);
        return yield* scheduler.admit(thread, { kind: 'keep-warm', signalId });
      }),
      steer: (thread, input, admitted) => scheduler.admit(thread, { kind: 'steer', input, admitted: admitted }),
      unqueue: Effect.fnUntraced(function* (threadId, ownerId, inputId) {
        const thread = yield* owned(threadId, ownerId);
        const holding = yield* holdingRun(thread.id);
        if (!holding) return false;
        const withdrawn = yield* scheduler
          .withdraw(thread.id, inputId)
          .pipe(Effect.mapError((failure) => (failure._tag === 'WithdrawFailed' ? new ThreadCallBroke({ cause: failure }) : failure)));
        if (withdrawn !== 'unsent') return withdrawn === 'withdrawn';
        const taken = yield* takeBackQueued(thread.id, inputId, {
          admits: (item) => item.kind === 'turn' || item.kind === 'compaction' || (item.kind === 'signal' && isReaderWordsItem(item)),
          slot: () => Effect.succeed(runInbox.takeBack(holding.id, inputId)),
        });
        if (taken && holding.status === 'running') yield* scheduler.queued(thread.id, holding);
        return taken;
      }),
      retract: Effect.fnUntraced(function* (threadId, ownerId, signalId, within) {
        const thread = yield* ownedMetadata(threadId, ownerId);
        const holder: {
          runId: string | null;
        } = { runId: null };
        const retired = yield* takeBackQueued(thread.id, signalId, {
          admits: (item) => item.kind === 'signal' && item.body.addressee === 'transport',
          slot: (tx) =>
            Effect.map(ledger.latestRun(thread.id, ['running'], tx), (running) => {
              holder.runId = running?.id ?? null;
              return true;
            }),
          within,
        });
        if (retired && holder.runId !== null) runInbox.takeBack(holder.runId, signalId);
        return retired;
      }),
      compact: Effect.fnUntraced(function* (threadId, ownerId, input = {}) {
        const thread = yield* owned(threadId, ownerId);
        const asked = yield* scheduler.admit(thread, { kind: 'compact', ask: input });
        switch (asked.status) {
          case 'started':
            return { status: 'started', runId: asked.run.id } satisfies ThreadCompacted;
          case 'joined':
            return { status: 'started', runId: asked.runId } satisfies ThreadCompacted;
          case 'requested':
            return {
              status: 'requested',
              requestId: asked.request.id,
              at: asked.request.body.at,
              runId: asked.runId,
            } satisfies ThreadCompacted;
        }
      }),
      checkInstructions: Effect.fnUntraced(function* (threadId, ownerId, definition) {
        const thread = yield* owned(threadId, ownerId);
        const checked = yield* assembly.instructions(thread, definition);
        if (checked.status === 'updated') yield* snapshots.publish(thread.id);
        return checked;
      }),
      answer: Effect.fnUntraced(function* (threadId, ownerId, input) {
        const thread = yield* owned(threadId, ownerId);
        const answered = yield* questions.answer(thread.id, input.questionId, input.answers, input.call);
        if (answered === null) {
          return yield* new ThreadCallBroke({
            cause: new ThreadInteractionConflictError({
              threadId: thread.id,
              runId: '',
              questionId: input.questionId,
              reason: 'This question is no longer answerable.',
            }),
          });
        }
        return { runId: answered.runId };
      }),
      attachContext: Effect.fnUntraced(function* (threadId, ownerId, input, call) {
        const thread = yield* owned(threadId, ownerId);
        const { title, text } = yield* Effect.try({
          try: () => prepareThreadContextAttachment(input),
          catch: (cause) => new ThreadCallBroke({ cause }),
        });
        const signal: ThreadSignal = {
          id: mintThreadSignalId(),
          type: ATTACHED_CONTEXT_SIGNAL_TYPE,
          addressee: 'reader',
          text,
          occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
        };
        yield* Effect.flatMap(
          transitionNow<undefined, ThreadWriteTx>(
            kernel,
            thread.id,
            {
              declared: sealThreadEvents([threadSignalEvent(signal, null, { title, modelText: attachedContextModelText(title, text) })]),
              decide: () => Effect.succeed({ apply: true, result: undefined } as const),
            },
            call === undefined
              ? { evidence: { decidedBy: `attach:${signal.id}` }, digest: actDigest(['attach', thread.id, signal.id]) }
              : { evidence: { call: callKey({ operation: 'attach', ...call }) }, digest: actDigest(['attach', thread.id, input]) },
          ),
          (outcome) => answerOf(thread.id, outcome),
        );
        yield* snapshots.publish(thread.id);
      }),
      append: (threadId, ownerId, events, toolOutputs, call) => appended(threadId, ownerId, events, toolOutputs, call),
      restart: Effect.fnUntraced(function* (threadId, ownerId, byThreadId) {
        const thread = yield* ownedMetadata(threadId, ownerId);
        const operation = `restart:${mintThreadEventId()}`;
        const openCallsOf = (run: ThreadRunRow) =>
          Effect.map(store.entriesOfRun(thread.id, run.id), (entries) => [
            ...new Map(unsettledEffects([...entries, ...(run.streamTail ?? [])], run.id).map((call) => [call.toolCallId, call])).values(),
          ]);
        const replaced = Effect.gen(function* () {
          const going = yield* ledger.activeRun(thread.id);
          const open = going === null ? [] : yield* openCallsOf(going);
          if (going !== null) {
            const stop = yield* Effect.forkDetach(
              Effect.result(
                stopping.stop(thread, { door: 'restart', by: 'reader', expected: going.id, settled: { within: RESTART_PATIENCE } }),
              ),
            );
            const stopped = yield* Effect.result(
              Fiber.join(stop).pipe(Effect.flatMap(Effect.fromResult), Effect.timeoutOption(RESTART_PATIENCE)),
            );
            const settled = stopped._tag === 'Success' && stopped.success._tag === 'Some' ? stopped.success.value : null;
            if (settled === null || settled.status === 'still-settling')
              yield* Effect.logWarning('the restart stop did not settle its run; the agent process is replaced anyway', {
                threadId: thread.id,
                runId: going.id,
                stop: stopped._tag === 'Failure' ? stopped.failure : (settled ?? 'no answer within the restart patience'),
              });
          }
          yield* stopping.release(thread, operation);
          const finished =
            going === null
              ? new Set<string>()
              : new Set(
                  (yield* store.entriesOfRun(thread.id, going.id)).flatMap((entry) =>
                    coreEntry(entry) && entry.type === 'tool' && entry.toolState === 'output-available' ? [entry.toolCallId] : [],
                  ),
                );
          const limited = going === null && threadRunLimited(yield* ledger.latestRun(thread.id));
          const continued = ((going !== null && going.kind !== 'compaction') || limited) && thread.capabilities.continue;
          const entry: ThreadRestartEntry = {
            type: 'restart',
            id: operation,
            stoppedRunId: going?.id,
            continued,
            byThreadId,
            calls: open.flatMap((call) =>
              finished.has(call.toolCallId) ? [] : [{ toolCallId: call.toolCallId, toolName: call.toolName }],
            ),
            occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
          };
          yield* appended(thread.id, ownerId, [{ kind: 'restart', payload: { entry } }]);
          if (!continued) yield* seated(thread);
          return { going, continued };
        });
        const work = Effect.gen(function* () {
          const { going, continued } = yield* Effect.acquireUseRelease(
            Effect.sync(() => admission.hold([thread.id])),
            () => replaced,
            (lift) => Effect.sync(() => lift(true)),
          );
          if (!continued) return { stoppedRunId: going?.id ?? null, runId: null };
          yield* agents.get(thread.agentId);
          const begun = yield* scheduler.admit(thread, { kind: 'continue' }).pipe(
            Effect.map((opened) => opened.runId),
            Effect.catchIf(
              (failure) =>
                failure instanceof ThreadCallBroke &&
                (failure.cause instanceof ThreadRunConflictError || failure.cause instanceof ThreadRunNotInterruptedError),
              () => Effect.map(ledger.latestRun(thread.id), (latest) => latest?.id ?? null),
            ),
          );
          return { stoppedRunId: going?.id ?? null, runId: begun };
        });
        return yield* Fiber.join(yield* Effect.forkDetach(work));
      }),
      sendSignal: Effect.fnUntraced(function* (threadId, ownerId, input, behavior = {}) {
        const thread = yield* owned(threadId, ownerId);
        return yield* scheduler.admit(thread, { kind: 'signal', input, behavior });
      }),
      deleteThread: deletion.remove,
      deleteByHost: Effect.fnUntraced(function* (ownerId, hostKind, hostId) {
        const threads = yield* store.listByHost(ownerId, hostKind, hostId);
        for (const thread of threads.filter((row) => !row.parentThreadId)) {
          yield* deletion.delete(thread);
        }
      }),
      snapshot: snapshots.snapshot,
      page: snapshots.page,
      attachFrom: snapshots.attachFrom,
      stop: (threadId, ownerId, expectedRunId, options) =>
        Effect.flatMap(ownedMetadata(threadId, ownerId), (thread) => stopping.byReader(thread, expectedRunId, options)),
      release: (threadId, ownerId) => Effect.flatMap(owned(threadId, ownerId), (thread) => stopping.release(thread)),
      seat: (threadId, ownerId) => Effect.flatMap(ownedMetadata(threadId, ownerId), seated),
      setModelSettings: Effect.fnUntraced(function* <T extends ThreadState>(
        threadId: string,
        ownerId: string,
        chosen: ThreadModelSettings,
        project: ThreadStateProject<T>,
      ) {
        const thread = yield* ownedMetadata(threadId, ownerId);
        yield* models.set(thread, chosen);
        yield* snapshots.publish(thread.id);
        return yield* snapshots.snapshot(thread.id, project);
      }),
      setAuthorityMode: (threadId, ownerId, mode, project) =>
        Effect.flatMap(owned(threadId, ownerId), (thread) => modes.move(thread, mode, project)),
    });
  }),
);
