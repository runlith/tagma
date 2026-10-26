import type { ModelSwitches } from '@runlith/llm/models/description';
import type { ThreadDefinition } from './agents/AgentProfile';
import { type Duration, Effect } from 'effect';
import type { AgentApprovalMode } from '../agent/contracts';
import type { ThreadChildSummary } from '../collaboration/ThreadPlaneAccess';
import { ThreadEnvelopes } from '../collaboration/ThreadEnvelopes';
import type { ThreadModelRefused } from '../collaboration/model';
import { carryModelMove, type CarriedMove, type ModelCarry, type ModelCarryAsk } from '../collaboration/modelCarry';
import type { ThreadRuns, ThreadRunsFailure } from '../collaboration/runs';
import type { RunAdmission } from './run/runAdmission';
import { ThreadSpawnTree } from '../collaboration/ThreadSpawnTree';
import type { ThreadAttachmentRef } from '../transcript/attachments';
import type { ThreadInteractionAnswer } from '../transcript/entries';
import type { ThreadSnapshotOf } from '../transcript/live';
import type { ThreadEventInput } from './events';
import type { AdmitCaller, CallerKey, ThreadInputOptions } from './keyed';
import type {
  ThreadRestoreAnswer,
  ThreadRewindAnswer,
  ThreadRewindAsk,
  ThreadRewindDraft,
  ThreadRewindPoints,
  ThreadRewindPreview,
} from './rewind';
import { ThreadAggregate, type ThreadContextAttachment } from './run/ThreadAggregate';
import { type AdmitItem, ThreadAdmission, type RunReceipt } from './run/ThreadAdmission';
import type { ThreadCompactAsk } from './run/ThreadCompactionRuns';
import { ThreadRewind, type ThreadRestoreInput, type ThreadRewindInput } from './run/ThreadRewind';
import { ThreadRunContexts, type ThreadContextAnswer, type ThreadContextAsk } from './run/ThreadRunContexts';
import { ThreadRunLedger } from './run/ThreadRunLedger';
import type { ThreadRestarted, ThreadStop, ThreadWithdrawal } from './ending';
import type { ThreadInstructionsChecked } from './run/assembly/prompt';
import type { ThreadCompacted } from './run/scheduler/compactions';
import type {
  ThreadKeepWarmResult,
  ThreadSaid,
  ThreadSignalBehavior,
  ThreadSignalInput,
  ThreadSignalResult,
  ThreadSteerInput,
} from './run/scheduler/inputs';
import { RunScheduler } from './run/scheduler/RunScheduler';
import type { ThreadSnapshot, ThreadState } from './state';
import type { ThreadResourceSummary } from './storage/resources';
import { bordered, ThreadCallBroke, type ThreadBorderFailed, type ThreadPortFailure } from './ThreadBorder';
import { type ThreadResidency, ThreadResourceLedger, type ThreadToolOutputScopeFaces, type ThreadWriteTx } from './ThreadPorts';

export type ThreadHandleServices =
  | ThreadAdmission
  | ThreadAggregate
  | ThreadEnvelopes
  | ThreadResourceLedger
  | ThreadRewind
  | ThreadRunContexts
  | ThreadResidency
  | ThreadRunLedger
  | ThreadSpawnTree
  | ThreadRuns
  | RunAdmission
  | RunScheduler;

export type ThreadHandleRun = <A, E>(work: Effect.Effect<A, E, ThreadHandleServices>) => Effect.Effect<A, E>;

export class ThreadHandle<TState extends ThreadState = ThreadState, TTx = unknown, TWrite extends TTx = TTx> {
  readonly threadId: string;
  readonly ownerId: string;
  private readonly run: ThreadHandleRun;
  private readonly toState: (state: ThreadState) => Effect.Effect<TState, ThreadBorderFailed>;

  constructor(
    run: ThreadHandleRun,
    toState: (state: ThreadState) => Effect.Effect<TState, ThreadBorderFailed>,
    threadId: string,
    ownerId: string,
  ) {
    this.run = run;
    this.toState = toState;
    this.threadId = threadId;
    this.ownerId = ownerId;
  }

  send(
    text: string,
    attachments?: readonly ThreadAttachmentRef[],
    options: ThreadInputOptions = {},
  ): Effect.Effect<ThreadSaid, ThreadBorderFailed> {
    return this.say('send', text, attachments, options);
  }

  admit(item: AdmitItem, caller: AdmitCaller, key: string): Effect.Effect<RunReceipt, ThreadBorderFailed> {
    return this.run(Effect.flatMap(ThreadAdmission, (admission) => admission.admit(this.threadId, this.ownerId, item, caller, key)));
  }

  private say(
    mode: 'send' | 'queue',
    text: string,
    attachments: readonly ThreadAttachmentRef[] | undefined,
    options: ThreadInputOptions,
  ): Effect.Effect<ThreadSaid, ThreadBorderFailed> {
    const item: AdmitItem = { kind: 'say', mode, text, attachments: attachments };
    return this.run(Effect.flatMap(ThreadAdmission, (admission) => admission.say(this.threadId, this.ownerId, item, options)));
  }

  begin(text?: string): Effect.Effect<{ readonly runId: string }, ThreadBorderFailed> {
    return this.run(Effect.flatMap(ThreadAggregate, (aggregate) => aggregate.begin(this.threadId, this.ownerId, text)));
  }

  keepWarm(signalId: string): Effect.Effect<ThreadKeepWarmResult, ThreadBorderFailed> {
    return this.run(Effect.flatMap(ThreadAggregate, (aggregate) => aggregate.keepWarm(this.threadId, this.ownerId, signalId)));
  }

  queue(
    text: string,
    attachments?: readonly ThreadAttachmentRef[],
    options: ThreadInputOptions = {},
  ): Effect.Effect<ThreadSaid, ThreadBorderFailed> {
    return this.say('queue', text, attachments, options);
  }

  steer(input: ThreadSteerInput, options: ThreadInputOptions = {}): Effect.Effect<ThreadSaid, ThreadBorderFailed> {
    return this.run(Effect.flatMap(ThreadAdmission, (admission) => admission.steer(this.threadId, this.ownerId, input, options)));
  }

  unqueue(inputId: string): Effect.Effect<boolean, ThreadBorderFailed> {
    const { threadId, ownerId } = this;
    return this.run(
      Effect.gen(function* () {
        const envelopes = yield* ThreadEnvelopes;
        if (yield* bordered(envelopes.withdrawRequest(threadId, ownerId, inputId))) return true;
        const aggregate = yield* ThreadAggregate;
        return yield* aggregate.unqueue(threadId, ownerId, inputId);
      }),
    );
  }

  retractSignal(
    signalId: string,
    within: (tx: TWrite) => Effect.Effect<void, ThreadPortFailure>,
  ): Effect.Effect<boolean, ThreadBorderFailed> {
    return this.run(
      Effect.flatMap(ThreadAggregate, (aggregate) =>
        aggregate.retract(this.threadId, this.ownerId, signalId, within as (tx: ThreadWriteTx) => Effect.Effect<void, ThreadPortFailure>),
      ),
    );
  }

  answer(input: {
    questionId: string;
    answers: readonly ThreadInteractionAnswer[];
    call?: CallerKey;
  }): Effect.Effect<{ runId: string }, ThreadBorderFailed> {
    return this.run(Effect.flatMap(ThreadAggregate, (aggregate) => aggregate.answer(this.threadId, this.ownerId, input)));
  }

  compact(input?: ThreadCompactAsk): Effect.Effect<ThreadCompacted, ThreadBorderFailed> {
    return this.run(Effect.flatMap(ThreadAggregate, (aggregate) => aggregate.compact(this.threadId, this.ownerId, input)));
  }

  checkInstructions(definition?: ThreadDefinition): Effect.Effect<ThreadInstructionsChecked, ThreadBorderFailed> {
    return this.run(Effect.flatMap(ThreadAggregate, (aggregate) => aggregate.checkInstructions(this.threadId, this.ownerId, definition)));
  }

  changeContext(ask: ThreadContextAsk<TWrite>): Effect.Effect<ThreadContextAnswer, ThreadBorderFailed> {
    const threadId = this.threadId;
    const erased = ask as ThreadContextAsk;
    return this.run(
      Effect.gen(function* () {
        const run = yield* (yield* ThreadRunLedger).activeRun(threadId);
        if (!run) {
          return yield* new ThreadCallBroke({
            cause: new Error(`No run of ${threadId} is going; a context change is asked of a run.`),
          });
        }
        return yield* (yield* ThreadRunContexts).request(run, erased);
      }),
    );
  }

  continue(): Effect.Effect<{ runId: string }, ThreadBorderFailed> {
    return this.run(
      Effect.map(
        Effect.flatMap(ThreadAggregate, (aggregate) => aggregate.continue(this.threadId, this.ownerId)),
        (begun) => ({ runId: begun.runId }),
      ),
    );
  }

  attachContext(input: ThreadContextAttachment, call?: CallerKey): Effect.Effect<void, ThreadBorderFailed> {
    return this.run(Effect.flatMap(ThreadAggregate, (aggregate) => aggregate.attachContext(this.threadId, this.ownerId, input, call)));
  }

  append(
    events: readonly ThreadEventInput[],
    toolOutputs?: ThreadToolOutputScopeFaces<TWrite>,
    call?: CallerKey,
  ): Effect.Effect<void, ThreadBorderFailed> {
    return this.run(
      Effect.flatMap(ThreadAggregate, (aggregate) =>
        aggregate.append(this.threadId, this.ownerId, events, toolOutputs as ThreadToolOutputScopeFaces | undefined, call),
      ),
    );
  }

  sendSignal(input: ThreadSignalInput, behavior: ThreadSignalBehavior<TWrite> = {}): Effect.Effect<ThreadSignalResult, ThreadBorderFailed> {
    return this.run(
      Effect.flatMap(ThreadAggregate, (aggregate) =>
        aggregate.sendSignal(this.threadId, this.ownerId, input, behavior as ThreadSignalBehavior<ThreadWriteTx>),
      ),
    );
  }

  stop(expectedRunId?: string, options: ThreadWithdrawal = {}): Effect.Effect<ThreadStop, ThreadBorderFailed> {
    return this.run(
      Effect.flatMap(ThreadAggregate, (aggregate) =>
        aggregate.stop(this.threadId, this.ownerId, expectedRunId, { ...options, door: 'handle' }),
      ),
    );
  }

  release(): Effect.Effect<'stopped' | 'not-running', ThreadBorderFailed> {
    return this.run(Effect.flatMap(ThreadAggregate, (aggregate) => aggregate.release(this.threadId, this.ownerId)));
  }

  restart(byThreadId?: string): Effect.Effect<ThreadRestarted, ThreadBorderFailed> {
    return this.run(Effect.flatMap(ThreadAggregate, (aggregate) => aggregate.restart(this.threadId, this.ownerId, byThreadId)));
  }

  seat(): Effect.Effect<void, ThreadBorderFailed> {
    return this.run(Effect.flatMap(ThreadAggregate, (aggregate) => aggregate.seat(this.threadId, this.ownerId)));
  }

  rewind(input: ThreadRewindInput): Effect.Effect<ThreadRewindAnswer, ThreadBorderFailed> {
    return this.run(Effect.flatMap(ThreadRewind, (rewind) => rewind.rewind(this.threadId, this.ownerId, input)));
  }

  restore(input: ThreadRestoreInput): Effect.Effect<ThreadRestoreAnswer, ThreadBorderFailed> {
    return this.run(Effect.flatMap(ThreadRewind, (rewind) => rewind.restore(this.threadId, this.ownerId, input)));
  }

  previewRewind(ask: ThreadRewindAsk): Effect.Effect<ThreadRewindPreview, ThreadBorderFailed> {
    return this.run(Effect.flatMap(ThreadRewind, (rewind) => rewind.preview(this.threadId, this.ownerId, ask)));
  }

  rewindPoints(): Effect.Effect<ThreadRewindPoints, ThreadBorderFailed> {
    return this.run(Effect.flatMap(ThreadRewind, (rewind) => rewind.points(this.threadId, this.ownerId)));
  }

  turnDraft(runId: string): Effect.Effect<ThreadRewindDraft | null, ThreadBorderFailed> {
    return this.run(Effect.flatMap(ThreadRewind, (rewind) => rewind.draft(this.threadId, this.ownerId, runId)));
  }

  setAuthorityMode(mode: AgentApprovalMode): Effect.Effect<ThreadSnapshotOf<TState>, ThreadBorderFailed> {
    return this.run(Effect.flatMap(ThreadAggregate, (aggregate) => aggregate.setAuthorityMode(this.threadId, this.ownerId, mode))).pipe(
      Effect.flatMap((base) => this.project(base)),
    );
  }

  setModelSettings(settings: {
    account?: string | null;
    provider: string;
    model: string;
    reasoning: string | null;
    switches: ModelSwitches;
  }): Effect.Effect<ThreadSnapshotOf<TState>, ThreadBorderFailed> {
    return this.run(Effect.flatMap(ThreadAggregate, (aggregate) => aggregate.setModelSettings(this.threadId, this.ownerId, settings))).pipe(
      Effect.flatMap((base) => this.project(base)),
    );
  }

  carryModel<A extends CarriedMove, E>(ask: ModelCarryAsk<A, E>): Effect.Effect<ModelCarry<A>, E | ThreadModelRefused | ThreadRunsFailure> {
    return this.run(carryModelMove(ask));
  }

  private project(base: ThreadSnapshot): Effect.Effect<ThreadSnapshotOf<TState>, ThreadBorderFailed> {
    const { transcript, before, live, ...state } = base;
    return Effect.map(this.toState(state), (projected) => ({ ...projected, transcript, before, live }));
  }

  held(): Effect.Effect<readonly ThreadResourceSummary[], ThreadBorderFailed> {
    return this.run(Effect.flatMap(ThreadResourceLedger, (ledger) => ledger.held(this.threadId)));
  }

  delete(within?: Duration.Duration): Effect.Effect<boolean, ThreadBorderFailed> {
    return this.run(Effect.flatMap(ThreadAggregate, (aggregate) => aggregate.deleteThread(this.ownerId, this.threadId, within)));
  }

  listChildren(): Effect.Effect<readonly ThreadChildSummary[], ThreadBorderFailed> {
    return this.run(bordered(Effect.flatMap(ThreadSpawnTree, (spawn) => spawn.listChildren(this.ownerId, this.threadId))));
  }
}
