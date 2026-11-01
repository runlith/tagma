import { Context, Duration, Effect, Layer, Queue, Schema } from 'effect';
import { RunStop } from '../../agent/RunStop';
import type { AgentToolDoor } from '../../agent/door/AgentToolDoor';
import { Tool } from '../../agent/tool';
import { approvalModesLayer } from '../../modes/ApprovalModes';
import type { ThreadInteractionAnswer, ThreadQuestionEntry } from '../../transcript/entries';
import { ThreadEntryKinds, makeThreadEntryReader } from '../../transcript/kinds';
import type { ThreadBorderFailed } from '../ThreadBorder';
import { ThreadAgentDoors } from '../agents/ThreadAgentDoors';
import { makeAgentRegistry } from '../agents/AgentRegistry';
import { ThreadAgents } from '../agents/ThreadAgents';
import { threadStorageLayer } from '../kernelPorts';
import {
  ThreadFeed,
  ThreadOwedCalls,
  ThreadOwner,
  ThreadToolRegistry,
  threadToolSources,
  type ThreadToolOutputScopeFaces,
} from '../ThreadPorts';
import { modeLawLayer } from '../../modes/ModeLaw';
import { makeMemoryRows } from '../storage/memory/ThreadRows';
import { makeMemoryRuns } from '../storage/memory/ThreadRuns';
import { makeMemoryEvents } from '../storage/memory/ThreadEvents';
import { makeMemoryOwnerSettings } from '../storage/memory/OwnerSettings';
import { ThreadMemory } from '../storage/memory/state';
import { inMemoryThreadTransitions } from '../storage/memory/ThreadTransitions';
import { inMemoryInboxStorage } from '../storage/InMemoryInboxStorage';
import { threadRunSequencesLayer } from '../transition/sequence';
import { transportsLayer } from '../transport/Transports';
import { approvalParkingLayer } from '../run/ApprovalParking';
import { Questions, questionsLayer } from '../run/Questions';
import { QuestionIntake } from '../run/scheduler/intake';
import { RunScheduler, type ParkedResume } from '../run/scheduler/RunScheduler';
import { RunExecution } from '../run/RunExecution';
import { RunLifecycle } from '../run/lifecycle/RunLifecycle';
import { threadRunContextsLayer } from '../run/ThreadRunContexts';
import { threadRunLedgerLayer } from '../run/ThreadRunLedger';
import { threadRunSettlementsLayer } from '../run/ThreadRunSettlements';
import { ThreadSnapshots } from '../run/ThreadSnapshots';
import { questionDoor } from './questionDoor';
import { emptyToolOutputs } from './runCycle/runDoubles';

export const parkedQuestions = Effect.fnUntraced(function* (
  options: {
    readonly toolDoor?: (door: AgentToolDoor) => Effect.Effect<AgentToolDoor, ThreadBorderFailed>;
    readonly toolOutputs?: ThreadToolOutputScopeFaces;
  } = {},
) {
  const unread = () => Effect.die('This question does not use this operation');
  const kinds = makeThreadEntryReader({ products: [] });
  const memory = new ThreadMemory(kinds);
  const aggregate = makeMemoryRows({ memory });
  const log = makeMemoryEvents({ memory });
  const runs = makeMemoryRuns({ memory, ownerId: 'owner-1', scope: 'scope-a' });
  const thread = yield* aggregate.insert({ id: 'thread-1', ownerId: 'owner-1', agentId: 'agent-1' });
  const started = yield* runs.createRun({
    startFrom: thread,
    kind: 'turn',
    runId: 'run-1',
    approval: { mode: 'review', interactive: true },
    progress: { stage: 'running', message: null },
  });
  const run = started.run;
  const { open } = yield* questionDoor;
  const resumed = yield* Queue.unbounded<ParkedResume<unknown>>();
  const door = open();
  const registry = yield* makeAgentRegistry();
  yield* registry.register(
    {
      id: 'agent-1',
      name: 'Question agent',
      description: 'A parked question owner.',
      runPolicy: { userStartable: true, backgroundStartable: false },
      grant: { sources: [] },
      prepare: unread,
      instructions: unread,
      toolCatalog: unread,
      toolDoor: unread,
    },
    'test',
  );
  const storage = threadStorageLayer({
    storage: aggregate,
    eventLog: log,
    transitions: inMemoryThreadTransitions({ memory }),
    createRuns: () => runs,
    inbox: inMemoryInboxStorage({ units: memory.units, calls: memory.records }),
    ownerSettings: makeMemoryOwnerSettings({ memory }),
    attachments: { keep: unread, resolve: unread, addressed: unread, hydrate: unread, sizes: unread },
    toolOutputs: {
      scope: () => ({ ...emptyToolOutputs, commitReferenced: () => Effect.void }),
      settleOpen: unread,
    },
  });
  const dependencies = Layer.mergeAll(
    storage,
    Layer.succeed(ThreadEntryKinds, kinds),
    Layer.succeed(ThreadOwner, { id: 'owner-1' }),
    Layer.succeed(ThreadOwedCalls, null),
    Layer.succeed(
      ThreadFeed,
      ThreadFeed.of({
        atCut: (_id, work) => work,
        tail: () => {},
        append: () => {},
        progress: () => {},
        view: () => ({ at: { position: 0, seq: 0 }, open: [], progress: null }),
        liveView: () => ({ incarnation: 'no-live-run', runId: null, at: { position: 0, seq: 0 }, open: [], progress: null }),
        publish: () => Effect.void,
        carry: () => Effect.void,
      }),
    ),
    modeLawLayer.pipe(Layer.provide(approvalModesLayer)),
    Layer.succeed(ThreadAgents, registry),
    Layer.succeed(ThreadToolRegistry, threadToolSources()),
    Layer.succeed(
      ThreadAgentDoors,
      ThreadAgentDoors.of({
        toolContext: () => Effect.succeed({ catalog: {}, toolOutputs: options.toolOutputs ?? emptyToolOutputs }),
        toolDoor: () => options.toolDoor?.(door) ?? Effect.succeed(door),
      }),
    ),
    Layer.succeed(
      RunExecution,
      RunExecution.of({
        create: unread,
        open: unread,
        enlist: unread,
        confirm: unread,
        resumeParked: unread,
        resume: unread,
        adopted: unread,
        track: unread,
        launch: unread,
        complete: unread,
        settle: unread,
        settling: unread,
        stop: unread,
        checkpoint: unread,
        settled: () => Effect.void,
        drained: unread,
        driven: () => {
          throw new Error('Questions do not delete threads');
        },
        holds: () => {
          throw new Error('Questions do not inspect execution ownership');
        },
        halted: () => {
          throw new Error('Questions do not inspect execution stop state');
        },
        haltOf: () => {
          throw new Error('Questions do not drive a run under its stop');
        },
        abort: unread,
      }),
    ),
    Layer.succeed(
      RunLifecycle,
      RunLifecycle.of({
        create: unread,
        observe: unread,
        resume: unread,
        park: () => Effect.succeed('parked'),
        beat: unread,
        stop: unread,
        drain: unread,
        finish: unread,
        handover: unread,
        adopt: unread,
        cut: unread,
        reap: unread,
      }),
    ),
    Layer.succeed(
      RunScheduler,
      RunScheduler.of({
        admit: unread,
        adopt: unread,
        withdraw: unread,
        queued: unread,
        launchBlocked: () => {
          throw new Error('Questions do not inspect the launch gate');
        },
        resume: (_run, answering) =>
          Effect.flatMap(answering({ halt: new RunStop(), interruptible: (work) => work }), (result) =>
            Effect.as(Queue.offer(resumed, result), result.answer),
          ),
      }),
    ),
    Layer.succeed(
      ThreadSnapshots,
      ThreadSnapshots.of({
        state: unread,
        snapshot: unread,
        attachFrom: unread,
        page: unread,
        statuses: unread,
        publish: () => Effect.void,
        committed: unread,
        forget: unread,
      }),
    ),
    transportsLayer,
    threadRunSettlementsLayer,
    approvalModesLayer,
  );
  const layer = questionsLayer.pipe(
    Layer.provideMerge(Layer.mergeAll(approvalParkingLayer, threadRunSequencesLayer, threadRunContextsLayer)),
    Layer.provideMerge(threadRunLedgerLayer),
    Layer.provideMerge(dependencies),
  );
  const context = yield* Layer.build(layer);
  const questions = Context.get(context, Questions);
  const intake = Context.get(context, QuestionIntake);
  const seed = (question: ThreadQuestionEntry) => aggregate.update(thread.id, { pendingInteraction: question });
  const park = Effect.fnUntraced(function* (question: ThreadQuestionEntry) {
    for (const call of question.toolCalls) {
      yield* door.preflight({
        name: call.toolName,
        input: {},
        toolCallId: call.toolCallId,
        tool: Tool.make({
          display: () => ({ form: 'none' }),
          approval: { asksFrom: 'review', timeout: Duration.minutes(2) },
          description: 'Wait for an answer.',
          parameters: Schema.Struct({}),
          execute: unread,
        }),
      });
    }
    return yield* intake.park(run, question, door);
  });
  return {
    aggregate,
    log,
    run,
    runs,
    door,
    questions,
    seed,
    park,
    resumed,
    answer: (answers: readonly ThreadInteractionAnswer[]) => questions.answer(thread.id, 'q-1', answers),
    close: (runId: string) => questions.close(thread.id, runId, 'run-stopped'),
    pending: () => Effect.map(aggregate.find(thread.id), (row) => row?.pendingInteraction ?? null),
    entries: () => aggregate.transcriptOf(thread.id),
    bypass: () => aggregate.update(thread.id, { authority: { mode: 'bypass', bypassFrom: 'review' } }),
  };
});
