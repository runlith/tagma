import { Cause, Clock, Context, Duration, Effect, Exit, Fiber, Layer, Result, Schedule, Scope, Semaphore } from 'effect';
import { readyAnswersFromToolCall } from '../../tools/ReadyAnswers';
import { activity, degradedSync } from '@runlith/activity/Activity';
import { ActivityLog } from '@runlith/activity/log';
import { toJson, type PartialJsonState } from '@runlith/utils/json';
import { TOOL_CALL } from '../../agent/activities';
import { RunStop } from '../../agent/RunStop';
import { ToolSettlements } from '../../agent/ToolSettlements';
import { Message, ToolResultPart, ToolResultValue } from '@runlith/llm/schema/messages';
import { AgentGuidanceJournal, pendingRuntimeGuides } from '../../agent/AgentGuidanceJournal';
import type { PendingRuntimeGuide } from '../../agent/contracts';
import { agentStepToolPolicy } from '../../agent/policy/AgentRuntimePolicy';
import { agentRuntimeGuidanceMessage } from '../../agent/AgentSignal';
import type { AgentToolInvocation } from '../../agent/door/types';
import { AgentToolFailed, type AgentToolCallRegenerated, type AgentToolCallReused, type AgentToolFailure } from '../../agent/AgentFailure';
import type { CallAdmission } from '../../agent/callProgress';
import {
  argumentsBody,
  initialToolDisplay,
  modelOutputBody,
  PREVIEW_PLACE,
  PREVIEW_WHY,
  previewed,
  type AgentToolModelOutput,
} from '../../agent/ToolOutput';
import { type Tool, documentAsked, toolExecute, toolPartialDisplay } from '../../agent/tool';
import { unknownToolName } from '../../agent/turn/tools';
import { unrevealedDefinition, type UnrevealedDefinition } from '../../agent/AgentDeferredTools';
import { toolArguments } from '../../agent/ToolArguments';
import type { ToolDisplay } from '../../tool/display';
import { USER_QUESTION_TOOL_NAME } from '../../transcript/parts';
import { toolSettled, type ThreadInteractionAnswer } from '../../transcript/entries';
import { hostedToolEntryId } from '../../transcript/entryNames';
import { coreEntry } from '../../transcript/kinds';
import { admittedToolSources } from '../agents/admittedToolSources';
import type { ThreadView } from '../agents/ThreadAgent';
import { ThreadAgents } from '../agents/ThreadAgents';
import { compositionEntry } from '../composition/entry';
import {
  threadCompositionEvent,
  threadContextEvent,
  threadEntryEvent,
  threadGuidanceEvent,
  threadStepMessagesEvent,
  type ThreadEventBody,
} from '../events';
import type { ThreadRow, ThreadRunRow } from '../rows';
import { bordered, ThreadCallBroke, type ThreadBorderFailed } from '../ThreadBorder';
import { Transports } from '../transport/Transports';
import { sealThreadEvents } from '../ThreadEventDoor';
import {
  ThreadAttachments,
  ThreadEventJournal,
  ThreadLeaseRhythm,
  ThreadOwner,
  ThreadStore,
  ThreadToolRegistry,
  ThreadTransitions,
  type ThreadWriteTx,
} from '../ThreadPorts';
import { ThreadNotFoundError } from '../storage/aggregate';
import { ThreadRunNotHeldError } from '../storage/runs';
import { answerOf, transitionNow } from '../transition/kernel';
import { ThreadJournalLane } from '../transition/lane';
import { ThreadEntryKinds } from '../../transcript/kinds';
import type { Decision } from '../transition/port';
import { HOSTED_RESULT, introducedIn, messageText, replaysOf, type HostedReplay } from './hostedReplay';
import { ModeLaw } from '../../modes/ModeLaw';
import { ThreadChanges } from './ThreadChanges';
import { ThreadRunLedger } from './ThreadRunLedger';
import { ThreadSnapshots } from './ThreadSnapshots';
import { ThreadRunSettlements } from './ThreadRunSettlements';
import { RunAssembly } from './assembly/RunAssembly';
import { pairedForProvider } from './toolPairing';
import {
  offeredBy,
  refused,
  type Hosted,
  type HostedAgent,
  type HostedAnswer,
  type HostedCall,
  type HostedOwing,
  type HostedReply,
  type HostedTools,
  type HostedTurn,
  type Settled,
} from './hostedParts';
import { admissionEntry, callFailed, ENDED, entryOf, failure, hostedExecutionOf, outcomeSettled, restartedSettled } from './hostedRecords';
import { questioned } from './hostedAsks';
import { placeSealed } from './hostedOrder';
import { queuedReason } from '../../agent/door/CallOrder';
import { HostedWords } from './hostedWords';
import { Questions } from './Questions';
import { KEEP_WARM_REFUSAL } from './keepWarmRun';

export class ThreadHosting extends Context.Service<
  ThreadHosting,
  {
    agent(threadId: string, agentId: string): Effect.Effect<HostedAgent, ThreadBorderFailed>;
    history(threadId: string, media?: 'hydrated' | 'referenced'): Effect.Effect<readonly Message[], ThreadBorderFailed>;
    open(threadId: string, agentId: string, owing?: HostedOwing): Effect.Effect<HostedTurn, ThreadBorderFailed>;
    tools(threadId: string, agentId: string): Effect.Effect<HostedTools, ThreadBorderFailed>;
    display(threadId: string, name: string, reading: PartialJsonState): ToolDisplay | undefined;
    call(call: HostedCall): Effect.Effect<HostedReply, ThreadBorderFailed>;
    holds(threadId: string, questionId: string): Effect.Effect<boolean, ThreadBorderFailed>;
    answer(
      threadId: string,
      questionId: string,
      answers: readonly ThreadInteractionAnswer[],
    ): Effect.Effect<{ readonly runId: string }, ThreadBorderFailed>;
  }
>()('@runlith/agent/ThreadHosting') {}

type Lock = { readonly lock: Semaphore.Semaphore; users: number };

type Step = {
  readonly events: readonly ThreadEventBody[];
  readonly messages: readonly Message[];
  readonly texts: readonly string[];
  readonly moved: boolean;
};

const broke = (cause: unknown) => new ThreadCallBroke({ cause });

const sameActive = (left: ReadonlySet<string> | null, right: ReadonlySet<string> | null): boolean =>
  left === right || (left !== null && right !== null && left.size === right.size && [...left].every((name) => right.has(name)));

const shownOf = (tool: Tool, declared: ToolDisplay | null | undefined): ToolDisplay | undefined =>
  declared == null ? undefined : initialToolDisplay({ declared, mutates: tool.mutates === true, keep: tool.keepsTail ? 'tail' : 'head' });

export const threadHostingLayer = Layer.effect(
  ThreadHosting,
  Effect.gen(function* () {
    const agents = yield* ThreadAgents;
    const store = yield* ThreadStore;
    const ledger = yield* ThreadRunLedger;
    const snapshots = yield* ThreadSnapshots;
    const assembly = yield* RunAssembly;
    const attachments = yield* ThreadAttachments;
    const sources = yield* ThreadToolRegistry;
    const log = yield* ActivityLog;
    const clock = yield* Clock.Clock;
    const settlements = yield* ToolSettlements;
    const laws = yield* ModeLaw;
    const questions = yield* Questions;
    const transports = yield* Transports;
    const changes = yield* ThreadChanges;
    const lease = yield* ThreadLeaseRhythm;
    const ownerId = (yield* ThreadOwner).id;
    const reached = (threadId: string, runId: string, callId: string): Effect.Effect<void, ThreadBorderFailed> =>
      bordered(
        Effect.gen(function* () {
          const run = yield* ledger.activeRun(threadId);
          const thread = run?.id === runId ? yield* store.metadata(threadId) : undefined;
          if (run === null || thread === undefined) return;
          const transport = yield* transports.of(thread.transport);
          yield* transport.runs.reached(run, { callId });
        }),
      );
    const kernel = {
      store,
      log: yield* ThreadEventJournal,
      transitions: yield* ThreadTransitions,
      lane: yield* ThreadJournalLane,
      kinds: yield* ThreadEntryKinds,
    };
    const lifetime = yield* Scope.Scope;
    const held = new Map<string, Hosted>();
    const locks = new Map<string, Lock>();

    const locked = <A, E>(threadId: string, work: Effect.Effect<A, E>): Effect.Effect<A, E> =>
      Effect.uninterruptibleMask((restore) =>
        Effect.suspend(() => {
          const standing = locks.get(threadId) ?? { lock: Semaphore.makeUnsafe(1), users: 0 };
          locks.set(threadId, standing);
          standing.users += 1;
          return restore(standing.lock.withPermit(work)).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                standing.users -= 1;
                if (standing.users === 0 && locks.get(threadId) === standing) locks.delete(threadId);
              }),
            ),
          );
        }),
      );

    const row = (threadId: string): Effect.Effect<ThreadRow, ThreadBorderFailed> =>
      Effect.flatMap(store.find(threadId), (found) => (found ? Effect.succeed(found) : Effect.fail(new ThreadNotFoundError(threadId))));

    const historyOf = (threadId: string): Effect.Effect<readonly Message[], ThreadBorderFailed> =>
      Effect.map(store.historyOf(threadId), (history) => history ?? []);

    const view = (thread: ThreadRow, agentId: string): ThreadView => ({ ...thread, agentId, transcript: [] });

    const ours = (run: ThreadRunRow): boolean => run.ownerId === ownerId;

    const owned = Effect.fnUntraced(function* (threadId: string): Effect.fn.Return<ThreadRunRow | null, ThreadBorderFailed> {
      const until = (yield* Clock.currentTimeMillis) + lease.takeoverAfterMs;
      for (;;) {
        const run = yield* ledger.activeRun(threadId);
        if (run === null || ours(run)) return run;
        const left = until - (yield* Clock.currentTimeMillis);
        if (left <= 0) return yield* Effect.fail(broke(new ThreadRunNotHeldError({ threadId, runId: run.id })));
        yield* Effect.sleep(Duration.millis(Math.min(left, lease.heartbeatIntervalMs)));
      }
    });

    const committed = (
      threadId: string,
      runId: string,
      plan: Omit<Decision<boolean, ThreadWriteTx>, 'apply' | 'result'>,
      events: Parameters<typeof sealThreadEvents>[0],
      decidedBy: string,
      running = false,
    ) =>
      Effect.flatMap(
        transitionNow<boolean, ThreadWriteTx>(
          kernel,
          threadId,
          {
            declared: sealThreadEvents(events),
            published: snapshots.committed,
            decide: (_view, tx) =>
              Effect.map(running ? ledger.activeRunIn(threadId, tx) : Effect.succeed(null), (run) =>
                running && (run?.id !== runId || !ours(run))
                  ? ({ refuse: false } as Decision<boolean, ThreadWriteTx>)
                  : ({ apply: true, result: true, ...plan } as Decision<boolean, ThreadWriteTx>),
              ),
          },
          { evidence: { decidedBy: `hosted:${runId}:${decidedBy}` }, digest: decidedBy },
        ),
        (outcome) => answerOf(threadId, outcome),
      );

    const released = Effect.fnUntraced(function* (
      threadId: string,
      hosted: Hosted,
      reason: string,
    ): Effect.fn.Return<void, ThreadBorderFailed> {
      if (held.get(threadId) === hosted) held.delete(threadId);
      hosted.halt.stop(new Error(reason));
      yield* Scope.close(hosted.scope, Exit.void);
      yield* questions.close(threadId, hosted.runId, reason);
    });

    yield* (yield* ThreadRunSettlements).subscribe({
      name: 'hosted runs',
      handle: (event) =>
        locked(
          event.threadId,
          Effect.suspend(() => {
            const hosted = held.get(event.threadId);
            return hosted === undefined || hosted.runId !== event.runId
              ? Effect.void
              : released(event.threadId, hosted, `The run ${event.status}.`);
          }),
        ),
    });

    const built = Effect.fnUntraced(function* (
      threadId: string,
      agentId: string,
      run: ThreadRunRow,
    ): Effect.fn.Return<Hosted, ThreadBorderFailed> {
      const thread = yield* row(threadId);
      const callGuides = new Map<string, PendingRuntimeGuide[]>();
      const words = new HostedWords(run, (yield* bordered(transports.of(thread.transport))).runs);
      const halt = new RunStop();
      const { handle, prepared, history } = yield* assembly.hosted({
        thread,
        agentId,
        run,
        stop: halt,
        ask: questions.ask,
        arrivals: words,
        onGuides: (directives, at) => {
          const guides = pendingRuntimeGuides(at.hook, directives, at);
          if (guides.length > 0) callGuides.set(at.toolCallId, [...(callGuides.get(at.toolCallId) ?? []), ...guides]);
        },
      });
      const journal = new AgentGuidanceJournal(run.id);
      const scope = yield* Scope.fork(lifetime);
      yield* Scope.addFinalizer(
        scope,
        Effect.suspend(() => {
          journal.close();
          halt.stop(new Error('The run stopped being hosted here.'));
          return handle.close();
        }),
      );
      yield* handle.place(0).pipe(
        Effect.mapError(broke),
        Effect.onError(() => Scope.close(scope, Exit.void)),
      );
      yield* Effect.forkIn(
        Effect.scoped(words.watch(changes)).pipe(
          Effect.tapCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.void
              : Effect.logWarning('a read of the words of a hosted run failed; watching again', { threadId, cause: Cause.pretty(cause) }),
          ),
          Effect.retry({ schedule: Schedule.spaced(Duration.seconds(1)) }),
        ),
        scope,
      );
      return {
        runId: run.id,
        keepWarm: run.kind === 'keep-warm',
        toolCatalog: thread.capabilities.toolCatalog,
        agentId,
        halt,
        modeOf: laws.of(threadId, thread.authority.mode),
        handle,
        prepared,
        journal,
        callGuides,
        scope,
        calls: new Map(),
        open: new Set(),
        replays: replaysOf(history),
        started: new Map(),
        words,
        step: 0,
        active: null,
        history,
      };
    });

    const hosting = (threadId: string, agentId: string): Effect.Effect<Hosted | null, ThreadBorderFailed> =>
      locked(
        threadId,
        Effect.gen(function* () {
          const run = yield* ledger.activeRun(threadId);
          const standing = held.get(threadId);
          if (standing !== undefined && run !== null && standing.runId === run.id && standing.agentId === agentId) return standing;
          if (standing !== undefined) yield* released(threadId, standing, 'The thread moved to another run.');
          if (run === null) return null;
          const hosted = yield* built(threadId, agentId, run);
          held.set(threadId, hosted);
          return hosted;
        }),
      );

    const guidance = (hosted: Hosted, guides: readonly PendingRuntimeGuide[]): Step => {
      const entry = hosted.journal.emit(hosted.step, guides);
      if (entry === null) return { events: [], messages: [], texts: [], moved: false };
      const messages = guides.map((guide) => agentRuntimeGuidanceMessage(guide.text, guide.state, guide.retell));
      return { events: [threadGuidanceEvent(entry)], messages, texts: messages.map(messageText), moved: false };
    };

    const stepped = Effect.fnUntraced(function* (hosted: Hosted, history: readonly Message[]): Effect.fn.Return<Step, ThreadBorderFailed> {
      if (hosted.open.size === 0) yield* hosted.handle.place(hosted.step).pipe(Effect.mapError(broke));
      yield* hosted.handle.refresh().pipe(Effect.mapError(broke));
      const directives = yield* hosted.handle.door
        .evaluate({
          hook: 'beforeStep',
          modelMessages: history,
          invocationKey: `step:${hosted.step}`,
          ordinal: hosted.step + 1,
        })
        .pipe(Effect.mapError(broke));
      const policy = agentStepToolPolicy(directives, Object.keys(hosted.handle.catalog()));
      const active = policy.activeTools === null ? null : new Set(policy.activeTools);
      const moved = !sameActive(hosted.active, active);
      hosted.active = active;
      return { ...guidance(hosted, pendingRuntimeGuides('beforeStep', directives)), moved };
    });

    const hydrated = (
      threadId: string,
      toolCallId: string,
      name: string,
      output: AgentToolModelOutput,
    ): Effect.Effect<AgentToolModelOutput, ThreadBorderFailed> =>
      output.type !== 'content'
        ? Effect.succeed(output)
        : Effect.map(
            attachments.hydrate(threadId, [Message.tool(ToolResultPart.from({ id: toolCallId, name, result: output }))]),
            (messages) => {
              const part = messages[0]?.content;
              if (typeof part === 'string' || part === undefined) return output;
              const result = part.find((each) => each.type === 'tool-result');
              return result?.type === 'tool-result' ? result.result : output;
            },
          );

    const recorded = (hosted: Hosted, call: HostedCall, settled: Settled): Effect.Effect<HostedAnswer, ThreadBorderFailed> => {
      const { output, failed, retained } = settled;
      const readyAnswers =
        settled.settlement.kind === 'answered'
          ? readyAnswersFromToolCall({ runId: hosted.runId, toolCallId: call.toolCallId, toolName: call.name, input: call.input })
          : Result.succeed(null);
      const readyEvents = Result.isSuccess(readyAnswers) && readyAnswers.success !== null ? [threadEntryEvent(readyAnswers.success)] : [];
      const threadId = call.threadId;
      const after = hosted.callGuides.get(call.toolCallId) ?? [];
      hosted.callGuides.delete(call.toolCallId);
      const attempt = Effect.fnUntraced(function* (waited: boolean): Effect.fn.Return<HostedAnswer, ThreadBorderFailed> {
        const landed = yield* locked(
          threadId,
          Effect.gen(function* () {
            const history = yield* historyOf(threadId);
            if (!waited && !introducedIn(history, call.toolCallId)) return null;
            const result = { id: call.toolCallId, name: call.name, result: output, retained: retained };
            hosted.open.delete(call.toolCallId);
            const told = guidance(hosted, after);
            const step = yield* stepped(hosted, [...history, Message.tool(ToolResultPart.from(result)), ...told.messages]);
            const message = Message.tool(
              ToolResultPart.from({ ...result, metadata: { [HOSTED_RESULT]: { failed, offered: step.moved } } }),
            );
            const event = threadStepMessagesEvent([message]);
            const written = yield* committed(
              threadId,
              hosted.runId,
              retained === undefined
                ? {}
                : {
                    participants: (unit: ThreadWriteTx) => hosted.handle.toolOutputs.commitReferenced([message], [], unit),
                    participantsUnseen: true,
                  },
              [
                threadEntryEvent(entryOf(hosted.runId, call, settled, hosted.started.get(call.toolCallId))),
                ...readyEvents,
                ...(event === null ? [] : [event]),
                ...told.events,
                ...step.events,
              ],
              `call:${call.toolCallId}`,
              true,
            );
            if (!written) return failure(ENDED);
            hosted.history = [...history, message, ...told.messages, ...step.messages];
            hosted.step += 1;
            return { output, failed, guides: [...told.texts, ...step.texts], offered: step.moved } as const;
          }),
        );
        if (landed !== null) return { ...landed, output: yield* hydrated(threadId, call.toolCallId, call.name, landed.output) };
        yield* reached(threadId, hosted.runId, call.toolCallId);
        return yield* attempt(true);
      });
      return attempt(false);
    };

    const entered = Effect.fnUntraced(function* (
      hosted: Hosted,
      call: HostedCall,
      display: ToolDisplay | undefined,
      admission: CallAdmission,
    ): Effect.fn.Return<boolean, ThreadBorderFailed> {
      const execution = hostedExecutionOf(admission);
      const landed = yield* committed(
        call.threadId,
        hosted.runId,
        {},
        [threadEntryEvent(admissionEntry(hosted.runId, call, execution, display))],
        `call:${call.toolCallId}:${execution.state}`,
        true,
      );
      if (landed && execution.state === 'started') hosted.started.set(call.toolCallId, execution);
      return landed;
    });

    const admitted =
      (hosted: Hosted, call: HostedCall, display: ToolDisplay | undefined) =>
      (admission: CallAdmission): Effect.Effect<void, AgentToolFailure> =>
        Effect.flatMap(
          entered(hosted, call, display, admission).pipe(
            Effect.mapError((cause) => new AgentToolFailed({ toolName: call.name, toolCallId: call.toolCallId, cause })),
          ),
          (landed) =>
            landed
              ? Effect.void
              : Effect.fail(new AgentToolFailed({ toolName: call.name, toolCallId: call.toolCallId, cause: new Error(ENDED) })),
        );

    const replayed = (call: HostedCall, replay: HostedReplay): Effect.Effect<HostedAnswer, ThreadBorderFailed> =>
      Effect.map(hydrated(call.threadId, call.toolCallId, call.name, replay.result.result), (output) => ({
        output,
        failed: replay.failed,
        guides: replay.guides,
        offered: replay.offered,
      }));

    const toolEntryOf = (threadId: string, runId: string, toolCallId: string) =>
      Effect.map(store.entryById(threadId, hostedToolEntryId(runId, toolCallId)), (entry) =>
        entry !== undefined && coreEntry(entry) && entry.type === 'tool' ? entry : undefined,
      );

    const unadmitted = (hosted: Hosted, call: HostedCall): Settled | null => {
      if (hosted.keepWarm) return refused(KEEP_WARM_REFUSAL);
      if (hosted.handle.catalog()[call.name] !== undefined) return null;
      const held = hosted.handle.withheld().find((entry) => entry.name === call.name);
      return refused(
        held === undefined
          ? unknownToolName(new Map(Object.entries(hosted.handle.catalog())), call.name)
          : `${call.name} is withheld from this run: ${held.reason}.`,
      );
    };

    const executed = Effect.fnUntraced(function* (
      hosted: Hosted,
      call: HostedCall,
      unrevealed: () => UnrevealedDefinition | null,
    ): Effect.fn.Return<Settled, AgentToolFailure | ThreadBorderFailed> {
      const tool = hosted.handle.catalog()[call.name];
      if (tool === undefined || toolExecute(tool) === null)
        return refused(unknownToolName(new Map(Object.entries(hosted.handle.catalog())), call.name));
      if (hosted.active !== null && !hosted.active.has(call.name)) {
        if (unrevealed() !== null)
          yield* toolArguments(tool, call.name, call.input, new Map(Object.entries(hosted.handle.catalog()))).pipe(
            Effect.mapError((cause) => new AgentToolFailed({ toolName: call.name, toolCallId: call.toolCallId, cause })),
          );
        return refused(`${call.name} is not offered at this step; reveal it first or call a tool the list carries.`);
      }
      const asked = { name: call.name, tool, input: call.input, toolCallId: call.toolCallId };
      const door = hosted.handle.door;
      yield* placeSealed(hosted, historyOf(call.threadId), call, changes, (toolCallId) =>
        toolEntryOf(call.threadId, hosted.runId, toolCallId),
      );
      const after = door.preflighted(asked) === null ? door.order.blockers(call.toolCallId) : [];
      if (after.length > 0) {
        const shown = yield* previewed(() =>
          shownOf(tool, toolPartialDisplay(tool, { value: toJson(call.input), complete: true, completedFields: [] })),
        );
        yield* admitted(hosted, call, shown)({ state: 'queued', reason: queuedReason(after), after });
      }
      const shown = Effect.suspend(() => {
        const ready = door.preflighted(asked);
        return ready === null ? Effect.succeed(undefined) : previewed(() => shownOf(tool, ready.display));
      });
      const invocation: AgentToolInvocation = {
        name: call.name,
        tool,
        input: call.input,
        arguments: call.arguments,
        onExecution: (admission) => Effect.flatMap(shown, (display) => admitted(hosted, call, display)(admission)),
        options: { toolCallId: call.toolCallId, messages: [...hosted.history] },
      };
      const attended = yield* door.attend(invocation);
      if (attended.kind === 'answered') return outcomeSettled(attended.outcome);
      const prepared = attended.prepared;
      const initial = yield* previewed(() => shownOf(tool, prepared.display));
      const asking = prepared.permission.verdict === 'ask';
      const failed = (refusal: AgentToolFailed | AgentToolCallReused | AgentToolCallRegenerated) =>
        Effect.succeed(callFailed(refusal, asking, initial, documentAsked(tool, call.input), unrevealed));
      return yield* door
        .settle({ ...invocation, confirming: asking ? true : undefined }, prepared)
        .pipe(
          Effect.map(outcomeSettled),
          Effect.catchTags({ AgentToolFailed: failed, AgentToolCallReused: failed, AgentToolCallRegenerated: failed }),
        );
    });

    const performed = Effect.fnUntraced(function* (hosted: Hosted, call: HostedCall): Effect.fn.Return<HostedAnswer, ThreadBorderFailed> {
      const replay = hosted.replays.get(call.toolCallId);
      if (replay !== undefined) return yield* replayed(call, replay);
      yield* reached(call.threadId, hosted.runId, call.toolCallId);
      const standing = yield* toolEntryOf(call.threadId, hosted.runId, call.toolCallId);
      const answered = standing !== undefined && toolSettled(standing.toolState);
      const told = answered ? replaysOf(yield* historyOf(call.threadId)).get(call.toolCallId) : undefined;
      if (told !== undefined) return yield* replayed(call, told);
      const unoffered = unadmitted(hosted, call);
      if (unoffered !== null) return yield* recorded(hosted, call, unoffered);
      if (call.name === USER_QUESTION_TOOL_NAME) {
        const answered = yield* activity(
          TOOL_CALL,
          { toolName: call.name, toolCallId: call.toolCallId, executedBy: 'host' },
          questioned(
            questions,
            hosted,
            call,
            Effect.flatMap(Clock.currentTimeMillis, (at) => entered(hosted, call, undefined, { state: 'started', at })),
          ),
          {
            thread: call.threadId,
            run: hosted.runId,
            parent: { run: hosted.runId },
            actor: { kind: 'thread', id: call.threadId },
            bodies: [argumentsBody(call.arguments)],
            ended: (exit) =>
              Exit.isSuccess(exit) ? { outcome: exit.value.failed ? 'refused' : 'ok', bodies: [modelOutputBody(exit.value.output)] } : {},
          },
        );
        return yield* recorded(hosted, call, answered);
      }
      if (standing !== undefined && standing.execution?.state !== 'queued') {
        return yield* recorded(hosted, call, restartedSettled(standing));
      }
      yield* hosted.words.refresh();
      const tool = hosted.handle.catalog()[call.name];
      const unrevealed = () => (tool === undefined ? null : unrevealedDefinition(call.name, tool, hosted.history));
      const document = documentAsked(tool, call.input);
      const settled = yield* executed(hosted, call, unrevealed).pipe(
        Effect.onError(() => Effect.sync(() => hosted.handle.door.order.release(call.toolCallId))),
        Effect.catchTags({
          AgentToolFailed: (refusal) => Effect.succeed(callFailed(refusal, false, undefined, document, unrevealed)),
          AgentToolCallReused: (refusal) => Effect.succeed(callFailed(refusal, false, undefined, document, unrevealed)),
          AgentToolCallRegenerated: (refusal) => Effect.succeed(callFailed(refusal, false, undefined, document, unrevealed)),
          AgentRuleFailed: (failed) => Effect.fail(broke(failed)),
          AgentHostFailed: (failed) => Effect.fail(broke(failed)),
        }),
      );
      return yield* recorded(hosted, call, settled);
    });

    const admittedCall = (hosted: Hosted, call: HostedCall): Effect.Effect<Fiber.Fiber<HostedAnswer, ThreadBorderFailed> | null> =>
      Effect.uninterruptible(
        Effect.suspend(() => {
          const standing = hosted.calls.get(call.toolCallId);
          if (standing !== undefined) return Effect.succeed(standing);
          if (hosted.halt.stopped) return Effect.succeed(null);
          hosted.open.add(call.toolCallId);
          return Effect.tap(
            Effect.forkIn(
              performed(hosted, call).pipe(
                Effect.provideService(ActivityLog, log),
                Effect.provideService(ToolSettlements, settlements),
                Effect.ensuring(Effect.sync(() => hosted.open.delete(call.toolCallId))),
              ),
              hosted.scope,
            ),
            (fiber) =>
              Effect.sync(() => {
                hosted.calls.set(call.toolCallId, fiber);
                fiber.addObserver(() => {
                  if (hosted.calls.get(call.toolCallId) !== fiber) return;
                  hosted.calls.delete(call.toolCallId);
                  hosted.started.delete(call.toolCallId);
                });
              }),
          );
        }),
      );

    return ThreadHosting.of({
      agent: Effect.fnUntraced(function* (threadId, agentId) {
        const thread = yield* row(threadId);
        const seen = view(thread, agentId);
        const agent = yield* agents.get(agentId);
        const standing = held.get(threadId);
        const web =
          standing !== undefined && standing.agentId === agentId
            ? standing.handle.web
            : agent.hostedWebOf === undefined
              ? 'none'
              : yield* agent.hostedWebOf({ thread: seen });
        const frozen = thread.pendingSystemPrompt ?? thread.systemPrompt;
        if (frozen !== null && frozen !== undefined) return { prompt: frozen, web };
        const run = yield* ledger.activeRun(threadId);
        const offered = yield* admittedToolSources(agents, sources, { thread: { ...thread, agentId }, run: run ?? undefined });
        return { prompt: (yield* agent.instructions({ thread: seen, sources: offered })).trim(), web };
      }),
      history: (threadId, media = 'hydrated') =>
        Effect.flatMap(historyOf(threadId), (history) =>
          media === 'referenced' ? Effect.succeed(pairedForProvider(history)) : attachments.hydrate(threadId, pairedForProvider(history)),
        ),
      open: Effect.fnUntraced(function* (threadId, agentId, owing) {
        const hosted = yield* hosting(threadId, agentId);
        if (hosted === null) return { context: null, prompt: null, web: 'none' as const };
        const run = yield* ledger.activeRun(threadId);
        const thread = yield* row(threadId);
        const context =
          run === null || run.kind === 'keep-warm'
            ? null
            : yield* hosted.prepared.orient({ ...view(thread, agentId), transcript: yield* store.entriesOfRun(threadId, run.id) });
        const owed = (told: string, commit?: (unit: ThreadWriteTx) => Effect.Effect<void, ThreadBorderFailed>) =>
          commit === undefined && owing === undefined
            ? {}
            : {
                participants: (unit: ThreadWriteTx) =>
                  Effect.andThen(commit?.(unit) ?? Effect.void, owing === undefined ? Effect.void : owing(told, unit)),
              };
        const opened: string[] = [];
        if (context !== null) {
          const told = messageText(context.message);
          yield* committed(threadId, hosted.runId, owed(told, context.commit), [threadContextEvent(context)], 'context');
          opened.push(told);
        }
        if (hosted.step === 0) {
          const composed = compositionEntry(
            hosted.runId,
            hosted.handle.instructions,
            hosted.handle.catalog(),
            context?.message ?? null,
            hosted.history,
          );
          yield* committed(threadId, hosted.runId, {}, [threadCompositionEvent(composed)], 'composition');
        }
        const step = yield* locked(
          threadId,
          Effect.gen(function* () {
            const history = yield* historyOf(threadId);
            const step = yield* stepped(hosted, history);
            if (step.events.length > 0)
              yield* committed(threadId, hosted.runId, owed(step.texts.join('\n\n')), step.events, `guidance:step:${hosted.step}`);
            hosted.history = [...history, ...step.messages];
            hosted.step += 1;
            return step;
          }),
        );
        opened.push(...step.texts);
        return { context: opened.length === 0 ? null : opened.join('\n\n'), prompt: hosted.handle.instructions, web: hosted.handle.web };
      }),
      tools: (threadId, agentId) => Effect.map(hosting(threadId, agentId), offeredBy),
      display: (threadId, name, reading) => {
        const hosted = held.get(threadId);
        const tool = hosted?.handle.catalog()[name];
        if (hosted === undefined || tool === undefined) return undefined;
        return degradedSync(
          { log, clock, thread: threadId, run: hosted.runId },
          PREVIEW_PLACE,
          PREVIEW_WHY,
          () => shownOf(tool, toolPartialDisplay(tool, reading)),
          () => undefined,
        );
      },
      call: Effect.fnUntraced(function* (call) {
        const idle = `Thread ${call.threadId} runs no turn, so no call of it is performed.`;
        if ((yield* owned(call.threadId)) === null) return { ...failure(idle), words: [] };
        const hosted = yield* hosting(call.threadId, call.agentId);
        if (hosted === null) return { ...failure(idle), words: [] };
        const fiber = yield* locked(call.threadId, admittedCall(hosted, call));
        if (fiber === null) return { ...failure(ENDED), words: [] };
        const exit = yield* Fiber.await(fiber);
        if (Exit.isFailure(exit))
          return yield* Cause.hasInterruptsOnly(exit.cause) ? Effect.fail(broke(new Error(ENDED))) : Effect.failCause(exit.cause);
        yield* hosted.words.refresh();
        return { ...exit.value, words: hosted.words.handed() };
      }),
      holds: (threadId, questionId) => questions.holds(threadId, questionId),
      answer: (threadId, questionId, answers) =>
        Effect.flatMap(questions.answer(threadId, questionId, answers), (answered) =>
          answered === null
            ? Effect.fail(broke(new Error(`Thread ${threadId} holds no open question ${questionId}.`)))
            : Effect.succeed(answered),
        ),
    });
  }),
);
