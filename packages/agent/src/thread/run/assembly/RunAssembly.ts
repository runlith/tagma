import { Context, Deferred, Effect, Layer, type Scope } from 'effect';
import type { Message } from '@runlith/llm/schema/messages';
import { visibleOutputToolNames } from '../../../agent/ToolCatalog';
import { AgentHostFailed } from '../../../agent/AgentFailure';
import type { RunStop } from '../../../agent/RunStop';
import type { ThreadHostedRun } from '../../agents/ThreadAgent';
import type { ThreadDefinition } from '../../agents/AgentProfile';
import type { ThreadQuestionEntry } from '../../../transcript/entries';
import type { ThreadTranscript, ThreadTranscriptEntry } from '../../../transcript/rows';
import { admittedToolSources } from '../../agents/admittedToolSources';
import type { AgentToolDoor } from '../../../agent/door/AgentToolDoor';
import type { ToolCatalog } from '../../../agent/ToolCatalog';
import {
  threadCaller,
  threadModelSelection,
  type ThreadHostInput,
  type ThreadPreparedRun,
  type ThreadRunHandle,
  type ThreadView,
} from '../../agents/ThreadAgent';
import { ThreadAgentDoors } from '../../agents/ThreadAgentDoors';
import { ThreadAgents } from '../../agents/ThreadAgents';
import { compositionEntry } from '../../composition/entry';
import { threadCompositionEvent, threadContextEvent } from '../../events';
import { ModeLaw } from '../../../modes/ModeLaw';
import { agentOf, type ThreadRow, type ThreadRunRow } from '../../rows';
import { ThreadCallBroke, type ThreadBorderFailed } from '../../ThreadBorder';
import { sealThreadEvents } from '../../ThreadEventDoor';
import {
  ThreadEventJournal,
  ThreadStore,
  ThreadToolOutputVault,
  ThreadToolRegistry,
  ThreadTransitions,
  type ThreadToolOutputScopeFaces,
  type ThreadTx,
  type ThreadWriteTx,
} from '../../ThreadPorts';
import { answerOf } from '../../transition/kernel';
import { ThreadJournalLane } from '../../transition/lane';
import { ThreadEntryKinds } from '../../../transcript/kinds';
import type { TransitionPlan } from '../../transition/port';
import { runTransition, ThreadRunSequences } from '../../transition/sequence';
import { priorToolRecords, questionFromToolCall, questionFromToolCalls, type ThreadQuestionToolCall } from '../ThreadQuestion';
import { RunProgress } from '../RunProgress';
import { ThreadRunContexts } from '../ThreadRunContexts';
import { ThreadSnapshots } from '../ThreadSnapshots';
import { makeThreadStreamRecorders, type ThreadStreamRecorder } from '../ThreadStreamRecorder';
import { makeThreadStreamSink, type ThreadStreamSink, type ThreadStreamQuestionResult } from '../ThreadStreamSink';
import { makeRunBoundary } from './boundary';
import { makeNativeRuns } from './native';
import { openingPhase } from './openingPhase';
import { runOutputs } from './outputs';
import { makePromptFreeze, type ThreadInstructionsChecked } from './prompt';
import { settleInterruptedEffects, type ThreadEffectSettlementResult } from '../ThreadEffectSettlement';
import { callConfirmation } from '../callConfirmation';
import type { AskQuestion } from '../scheduler/intake';

export type RunBasis = {
  readonly thread: ThreadRow;
  readonly run: ThreadRunRow;
  readonly transcript: ThreadTranscript;
};

export type RunOpening = RunBasis & { readonly stepsTaken: number; readonly stop: RunStop };

export type NativeRun = {
  readonly handle: ThreadRunHandle<ThreadTx>;
  readonly recorder: ThreadStreamRecorder;
  readonly thread: ThreadRow;
  readonly shownTools: ReadonlySet<string>;
  questionForTools(calls: readonly ThreadQuestionToolCall[]): Effect.Effect<ThreadQuestionEntry | null, ThreadCallBroke>;
  start(questionResult: ThreadStreamQuestionResult | undefined): Effect.Effect<void>;
  ready(): void;
};

export type ThreadHostedHandle = ThreadHostedRun & {
  readonly toolOutputs: ThreadToolOutputScopeFaces;
  readonly systemPromptEntry: ThreadTranscriptEntry | null;
};

export type HostedParts = {
  readonly handle: ThreadHostedHandle;
  readonly prepared: ThreadPreparedRun<ThreadWriteTx>;
  readonly history: readonly Message[];
};

export type AdoptedRun = {
  readonly catalog: ToolCatalog;
  settle(): Effect.Effect<ThreadEffectSettlementResult, ThreadBorderFailed>;
  withDoor<A, E, R>(use: (door: AgentToolDoor) => Effect.Effect<A, E, R>): Effect.Effect<A, E | ThreadBorderFailed, R>;
};

export class RunAssembly extends Context.Service<
  RunAssembly,
  {
    native(
      opening: RunOpening,
      options: { readonly oriented: boolean; readonly ask: AskQuestion; readonly opened?: Deferred.Deferred<void, ThreadBorderFailed> },
    ): Effect.Effect<NativeRun, ThreadBorderFailed, Scope.Scope>;
    adopted(basis: RunBasis): Effect.Effect<AdoptedRun, ThreadBorderFailed>;
    hosted(input: {
      readonly thread: ThreadRow;
      readonly agentId: string;
      readonly run: ThreadRunRow;
      readonly stop: RunStop;
      readonly ask: AskQuestion;
      readonly onGuides?: ThreadHostInput['onGuides'];
      readonly arrivals?: ThreadHostInput['arrivals'];
    }): Effect.Effect<HostedParts, ThreadBorderFailed>;
    instructions(thread: ThreadRow, definition?: ThreadDefinition): Effect.Effect<ThreadInstructionsChecked, ThreadBorderFailed>;
  }
>()('@runlith/agent/RunAssembly') {}

export const runAssemblyLayer = Layer.effect(
  RunAssembly,
  Effect.gen(function* () {
    const agents = yield* ThreadAgents;
    const doors = yield* ThreadAgentDoors;
    const progress = yield* RunProgress;
    const sequences = yield* ThreadRunSequences;
    const snapshots = yield* ThreadSnapshots;
    const store = yield* ThreadStore;
    const vault = yield* ThreadToolOutputVault;
    const toolSources = yield* ThreadToolRegistry;
    const laws = yield* ModeLaw;
    const kernel = {
      store,
      log: yield* ThreadEventJournal,
      transitions: yield* ThreadTransitions,
      lane: yield* ThreadJournalLane,
      kinds: yield* ThreadEntryKinds,
    };
    const prompt = yield* makePromptFreeze({ kernel });
    const contexts = yield* ThreadRunContexts;
    const runBoundary = yield* makeRunBoundary;
    const natives = yield* makeNativeRuns({ kernel, prompt });
    const recordStream = yield* makeThreadStreamRecorders;

    const admittedOf = (run: ThreadRunRow) =>
      Effect.map(contexts.read({ id: run.id, threadId: run.threadId }), (state) => state.admitted?.record ?? null);

    const inRun = <A>(threadId: string, runId: string, plan: TransitionPlan<A, ThreadWriteTx>, request: unknown) =>
      Effect.flatMap(runTransition(kernel, sequences, { id: runId, threadId }, plan, request), (outcome) => answerOf(threadId, outcome));

    const oriented = Effect.fnUntraced(function* (opening: RunOpening, prepared: ThreadPreparedRun<ThreadWriteTx>) {
      const { thread, run } = opening;
      const context = yield* prepared.orient({ ...thread, transcript: opening.transcript });
      if (context === null) return { thread, transcript: opening.transcript, context: null };
      const commit = context.commit;
      const declared = sealThreadEvents([threadContextEvent(context)]);
      let committed: ThreadRow | undefined;
      yield* inRun<null>(
        thread.id,
        run.id,
        {
          declared,
          decide: (view) =>
            Effect.sync(() => {
              committed = { ...view.row, history: view.state.history, contextReading: view.state.contextReading };
              return {
                apply: true,
                result: null,
                participants: commit ? (unit: ThreadWriteTx) => commit(unit) : undefined,
              } as const;
            }),
        },
        ['context', run.id, declared.map((event) => event.id)],
      );
      const current = committed ?? (yield* store.find(thread.id));
      if (current === undefined) return yield* Effect.die(new Error(`Thread ${thread.id} disappeared after its context committed.`));
      const entry = context.entry;
      const transcript = entry === undefined ? opening.transcript : [...opening.transcript.filter((held) => held.id !== entry.id), entry];
      return { thread: current, transcript, context };
    });

    const native = Effect.fnUntraced(function* (
      opening: RunOpening,
      options: { readonly oriented: boolean; readonly ask: AskQuestion; readonly opened?: Deferred.Deferred<void, ThreadBorderFailed> },
    ) {
      const { run } = opening;
      const { waitingOn } = yield* openingPhase(progress, run);
      const recorderReady = Deferred.makeUnsafe<ThreadStreamRecorder>();
      const sinkReady = Deferred.makeUnsafe<ThreadStreamSink>();
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          Deferred.doneUnsafe(sinkReady, Effect.die(new Error('The run closed before its recorder opened.')));
        }),
      );
      const flushRecorded = Deferred.await(recorderReady).pipe(Effect.flatMap((recorder) => recorder.flushRecorded()));
      const interruptedRecorded = (toolCallIds: readonly string[]) =>
        Deferred.await(recorderReady).pipe(Effect.flatMap((recorder) => recorder.interruptedRecorded(toolCallIds)));
      const sources = yield* admittedToolSources(agents, toolSources, { thread: opening.thread, run });
      const outputs = runOutputs(vault, { thread: opening.thread, run }, sources);
      const stepsTaken = opening.stepsTaken;
      const held = { tracked: false };
      const { turned, handle } = yield* Effect.gen(function* () {
        const agent = yield* agents.get(opening.thread.agentId);
        const prepared = yield* agent.prepare({
          thread: { ...opening.thread, transcript: opening.transcript },
          run,
          supply: outputs.supply,
          admitted: yield* admittedOf(run),
          waitingOn,
        });
        const turned = options.oriented
          ? yield* oriented(opening, prepared)
          : { thread: opening.thread, transcript: opening.transcript, context: null };
        const current = turned.thread;
        const priorTools = priorToolRecords(turned.transcript, run.id);
        const modeOf = laws.of(current.id, current.authority.mode);
        const handle = yield* Effect.uninterruptibleMask((restore) =>
          restore(
            natives.start({
              thread: { ...current, transcript: turned.transcript },
              run,
              stop: opening.stop,
              prepared,
              outputs,
              model: threadModelSelection(current),
              modeOf,
              messages: current.history,
              sink: { push: (event) => Deferred.await(sinkReady).pipe(Effect.flatMap((sink) => sink.push(event))) },
              callHooks: {
                ...outputs.retention.hooks,
                asking: callConfirmation(options.ask, modeOf),
                completed: (call, exit) =>
                  Deferred.await(recorderReady).pipe(
                    Effect.flatMap((recorder) => recorder.completed(call, exit)),
                    Effect.orDie,
                  ),
              },
              instructions: current.systemPrompt ?? undefined,
              priorTools: priorTools.length > 0 ? priorTools : undefined,
              stepsTaken: stepsTaken > 0 ? stepsTaken : undefined,
              keepWarm: run.kind === 'keep-warm',
              commitEffects: (intent) =>
                Deferred.await(recorderReady).pipe(
                  Effect.flatMap((recorder) => recorder.commitStepIntent(intent)),
                  Effect.mapError((cause) => new AgentHostFailed({ port: 'commitEffects', cause })),
                ),
              onProgress: snapshots.publish(current.id),
              flushRecorded,
              interruptedRecorded,
              onSignalsDelivered: () => snapshots.publish(current.id),
            }),
          ).pipe(Effect.tap((started) => Effect.addFinalizer(() => (held.tracked ? Effect.void : started.close())))),
        );
        return { turned, handle };
      }).pipe(Effect.onError(() => outputs.retention.runEnded));
      const current = turned.thread;
      const transcript = turned.transcript;

      const composition = compositionEntry(run.id, handle.instructions, handle.catalog, turned.context?.message ?? null, current.history);
      const composed = sealThreadEvents([threadCompositionEvent(composition)]);
      yield* inRun<undefined>(
        current.id,
        run.id,
        { declared: composed, decide: () => Effect.succeed({ apply: true, result: undefined } as const) },
        ['composition', run.id, composed.map((event) => event.id)],
      );
      const recorded = [...transcript.filter((entry) => entry.id !== composition.id), composition];
      const questionForTool = (call: ThreadQuestionToolCall, askedAt: string) =>
        questionFromToolCall(run, handle.door, handle.catalog, call, askedAt);
      const recorder = yield* recordStream({
        threadId: current.id,
        run,
        transcript: recorded,
        stepsTaken,
        steps: handle.completedSteps,
        toolOutputs: handle.toolOutputs,
        contextWindow: () => handle.contextWindow(),
        inputLimit: () => handle.inputLimit(),
      });
      const sink = makeThreadStreamSink({
        runId: run.id,
        record: (chunk) =>
          recorder.push(chunk).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                if (options.opened) Deferred.doneUnsafe(options.opened, Effect.void);
              }),
            ),
            Effect.orDie,
          ),
        questionForTool,
      });
      Deferred.doneUnsafe(recorderReady, Effect.succeed(recorder));
      return {
        handle,
        recorder,
        thread: current,
        shownTools: visibleOutputToolNames(handle.catalog),
        questionForTools: (calls) => questionFromToolCalls(run, handle.door, handle.catalog, calls),
        start: (questionResult) => sink.open(handle.systemPromptEntry ? [handle.systemPromptEntry] : [], questionResult),
        ready: () => {
          held.tracked = true;
          Deferred.doneUnsafe(sinkReady, Effect.succeed(sink));
        },
      } satisfies NativeRun;
    });

    const adopted = Effect.fnUntraced(function* ({ thread, run, transcript }: RunBasis) {
      const view: ThreadView = { ...thread, transcript };
      const sources = yield* admittedToolSources(agents, toolSources, { thread, run });
      const restored = yield* admittedOf(run);
      const context = yield* doors.toolContext({ thread: view, run, sources, admitted: restored });
      return {
        catalog: context.catalog,
        settle: () =>
          settleInterruptedEffects({
            kernel,
            run,
            entries: transcript,
            catalog: context.catalog,
            caller: threadCaller(view, run.id),
          }).pipe(Effect.onExit(() => context.toolOutputs.dispose().pipe(Effect.ignore))),
        withDoor: (use) =>
          Effect.uninterruptibleMask((restore) =>
            Effect.flatMap(restore(doors.toolDoor({ thread: view, run, admitted: restored })), (door) =>
              restore(use(door)).pipe(Effect.ensuring(door.close())),
            ),
          ),
      } satisfies AdoptedRun;
    });

    return RunAssembly.of({
      native,

      adopted,

      hosted: Effect.fnUntraced(function* ({ thread, agentId, run, stop, ask, onGuides, arrivals }) {
        const current = yield* prompt.pendingApplied(thread, run.id);
        const selected = current.agentId === thread.agentId ? agentId : current.agentId;
        const agent = yield* agents.get(selected);
        const view: ThreadView = { ...current, agentId: selected, transcript: yield* store.entriesOfRun(thread.id, run.id) };
        const offered = yield* admittedToolSources(agents, toolSources, { thread: { ...current, agentId: selected }, run });
        const { retention, heldScope, supply } = runOutputs(vault, { thread: view, run }, offered);
        const hosting = { ...run, interactive: true };
        let systemPromptEntry: ThreadTranscriptEntry | null = null;
        const { prepared, hostedRun } = yield* Effect.gen(function* () {
          const prepared = yield* agent.prepare({ thread: view, run: hosting, supply, admitted: yield* admittedOf(run) });
          if (prepared.host === undefined) {
            return yield* new ThreadCallBroke({
              cause: new Error(`Agent ${agentId} runs only its own loop, so no external loop can host it.`),
            });
          }
          const modeOf = laws.of(thread.id, thread.authority.mode);
          const hostedRun = yield* prepared.host({
            thread: view,
            run: hosting,
            stop,
            model: threadModelSelection(thread),
            modeOf,
            commitInstructions: (instructions: string) =>
              prompt.frozen(thread.id, run.id, instructions, (entry) => {
                systemPromptEntry = entry;
              }),
            toolOutputs: heldScope,
            callHooks: { ...retention.hooks, asking: callConfirmation(ask, modeOf) },
            onGuides: onGuides,
            arrivals: arrivals,
            boundary: runBoundary({ id: run.id, threadId: thread.id }, supply, () => stop.stopped),
          });
          return { prepared, hostedRun };
        }).pipe(Effect.onError(() => retention.runEnded));
        return {
          handle: {
            ...hostedRun,
            toolOutputs: heldScope,
            systemPromptEntry,
            close: () => Effect.andThen(hostedRun.close(), retention.runEnded),
          },
          prepared,
          history: thread.history,
        };
      }),

      instructions: (thread, definition) => {
        const current = definition === undefined ? thread : { ...thread, ...definition };
        const served = agentOf(current);
        return Effect.flatMap(admittedToolSources(agents, toolSources, { thread: { ...current, agentId: served } }), (sources) =>
          prompt.check(current, served, sources, definition !== undefined),
        );
      },
    });
  }),
);
