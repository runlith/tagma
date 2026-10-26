import { Cause, Clock, Duration, Effect, Fiber, FiberMap, Option } from 'effect';
import type { NativeExit } from '@runlith/executions/protocol/execution';
import type { ProcessWitness } from '@runlith/executions/protocol/evidence';
import { harnessRunKey } from './launch.js';
import { threadCallFailed } from '../../threads/contract/service/failure.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { ThreadRecords } from '../../thread-record/contract/service/records.js';
import type { Terminals } from '../../executions/contract/service/terminals.js';
import type { TerminalWriting } from '../../executions/contract/service/writing.js';
import type { TerminalRequests } from '../../executions/contract/service/terminals.js';
import type { ExecutionProcessEvidence, TerminalScreens } from '../../executions/contract/service/records.js';
import type { HarnessExecutionRef } from '../../threads/contract/wire/harness/observation.js';
import type { HarnessProcessOutcome, HarnessSession } from '../../threads/contract/wire/harness/session.js';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';
import { harnessAdapter } from '../contract/service/table.js';
import type { HarnessSessionStore } from '../store/sessions.js';
import type { HarnessLanes } from './lanes.js';
import { jobState, RETAINED_READING_MS, type JobState } from '../adoption/shellJob.js';
import { typeHarnessKeys } from './keyboard.js';
import { executionHandshakeMs } from '../../executions/contract/wire/terminalBehavior.js';
import {
  endsAbortedWhenGone,
  exitLine,
  LOST_LINE,
  UNLAUNCHED_LINE,
  shellEndedLine,
  QUIT_BEAT_MS,
  QUIT_WAIT_MS,
  BACKGROUND_WORDS,
  type Measured,
} from './lifecycle.js';

type Finish = (
  threadId: string,
  sessionId: string,
  outcome: HarnessProcessOutcome,
  failure: string | null,
  options?: { readonly stopWins?: boolean },
) => Effect.Effect<void, HarnessFailure>;

const standing = { _tag: 'Standing' } as const;

export class SessionLifecycle {
  constructor(
    private readonly store: HarnessSessionStore,
    private readonly records: ThreadRecords['Service'],
    private readonly terminals: Terminals['Service'],
    private readonly screens: TerminalScreens['Service'],
    private readonly writing: TerminalWriting['Service'],
    private readonly evidence: ExecutionProcessEvidence['Service'],
    private readonly requests: TerminalRequests['Service'],
    private readonly lanes: HarnessLanes,
    private readonly fibers: FiberMap.FiberMap<string, void, never>,
    private readonly ownerId: string,
    private readonly finish: Finish,
  ) {}

  readonly jobOf = Effect.fnUntraced(
    function* (this: SessionLifecycle, shell: HarnessExecutionRef, witness: ProcessWitness | undefined) {
      const { terminals, evidence } = this;
      if (witness === undefined) return 'unread' as const;
      const since = yield* Clock.currentTimeMillis;
      const record = yield* terminals.record(shell.execution, shell.incarnation);
      if (record === null) return 'unread' as const;
      let report = yield* evidence.processes(record.execution);
      if (report !== undefined && report.observedAt < since) {
        const now = yield* Clock.currentTimeMillis;
        yield* Effect.sleep(Math.max(0, Math.min(RETAINED_READING_MS, report.observedAt + RETAINED_READING_MS - now)));
        report = yield* evidence.processes(record.execution);
      }
      if (report === undefined || report.observedAt < since) return 'unread' as const;
      return yield* jobState(report, witness, evidence.foreground(record.execution));
    },
    Effect.catch(() => Effect.succeed('unread' as const)),
  );

  foreground(shell: HarnessExecutionRef, witness: ProcessWitness): Effect.Effect<void, HarnessFailure> {
    return Effect.flatMap(this.jobOf(shell, witness), (job) =>
      job === 'foreground'
        ? Effect.void
        : new GateRefusal('cli-background', BACKGROUND_WORDS[job], [
            'bring the CLI back to its terminal’s foreground (fg), then send again',
            'open its terminal from the thread',
          ]),
    );
  }

  readonly quit = Effect.fnUntraced(function* (
    this: SessionLifecycle,
    threadId: string,
    sessionId: string,
    before: { readonly state: HarnessSession['state'] },
  ) {
    const { store, lanes, terminals, screens, writing, ownerId, finish } = this;
    const facet = yield* store.read(threadId);
    const session = facet?.session;
    if (facet == null || session === undefined || session.id !== sessionId || session.state === 'ended') return 'stopped' as const;
    const shell = facet.execution;
    const witness = session.job;
    if (shell === null || witness === undefined) return yield* this.awaitDrive(threadId);
    const declared = harnessAdapter(facet.name).quit;
    let why = declared === null ? `no way to quit ${harnessAdapter(facet.name).label} is measured` : null;
    const act = `quit:${sessionId}:${crypto.randomUUID()}`;
    for (const [index, keys] of (declared ?? []).entries()) {
      const job = yield* this.jobOf(shell, witness);
      if (job === 'gone') break;
      if (job !== 'foreground') {
        why = BACKGROUND_WORDS[job];
        break;
      }
      const typed = yield* Effect.result(
        lanes.typing(sessionId, (lane) => typeHarnessKeys(terminals, screens, writing, lane, shell, keys, `${act}:${index}`)),
      );
      if (typed._tag === 'Failure') {
        why = typed.failure instanceof GateRefusal ? typed.failure.reason : `the quit keys could not be typed: ${String(typed.failure)}`;
        break;
      }
      yield* Effect.sleep(QUIT_BEAT_MS);
    }
    if (yield* this.awaitLeft(shell, witness)) {
      yield* finish(threadId, sessionId, 'aborted', null);
      return yield* this.awaitDrive(threadId);
    }
    const after = yield* store.read(threadId);
    if (after?.session?.id !== sessionId || after.session.state === 'ended') return yield* this.awaitDrive(threadId);
    yield* store.owned(threadId, sessionId, ownerId, (current, held) => {
      if (held.state !== 'stopping') return current;
      const { retiring: _retiring, ...rest } = current;
      return {
        ...rest,
        session: { ...held, state: before.state === 'stopping' ? 'running' : before.state },
      };
    });
    return yield* new GateRefusal(
      'cli-standing',
      `The CLI in terminal ${shell.execution} still stands after it was asked to quit${why === null ? '' : ` — ${why}`}. The session keeps running, and the terminal was left as it stands.`,
      ['quit the CLI in its terminal, then stop the thread again', 'open the thread’s terminal and end the CLI by hand'],
    );
  });

  readonly awaitLeft = Effect.fnUntraced(function* (this: SessionLifecycle, shell: HarnessExecutionRef, witness: ProcessWitness) {
    const until = (yield* Clock.currentTimeMillis) + QUIT_WAIT_MS;
    while (true) {
      if ((yield* this.jobOf(shell, witness)) === 'gone') return true;
      if ((yield* Clock.currentTimeMillis) >= until) return false;
      yield* Effect.sleep(QUIT_BEAT_MS);
    }
  });

  readonly awaitDrive = Effect.fnUntraced(function* (this: SessionLifecycle, threadId: string) {
    const watching = yield* FiberMap.get(this.fibers, threadId).pipe(Effect.option);
    if (Option.isSome(watching) && Option.isSome(watching.value)) yield* Fiber.await(watching.value.value);
    return 'stopped' as const;
  });

  private readonly settle = Effect.fn('HarnessSessions.reconcile')(function* (
    this: SessionLifecycle,
    threadId: string,
    facet: ExternalSession,
  ) {
    const session = facet.session!;
    const measured = yield* this.measure(threadId, facet);
    if (measured._tag === 'Standing') return;
    if (measured._tag === 'Exited') return yield* this.exited(threadId, session, measured.exit, facet.execution);
    if (measured._tag === 'Left') return yield* this.finish(threadId, session.id, 'completed', null, { stopWins: true });
    if (measured._tag === 'Closed') return yield* this.finish(threadId, session.id, 'aborted', null);
    const aborted = endsAbortedWhenGone(session, facet.retiring);
    const failure = session.failure === undefined ? measured.failure : `${measured.failure} — ${session.failure}`;
    yield* this.finish(threadId, session.id, aborted ? 'aborted' : 'failed', aborted ? null : failure, { stopWins: true });
  });

  readonly reconcile = Effect.fnUntraced(function* (this: SessionLifecycle, threadId: string, facet: ExternalSession) {
    yield* this.settle(threadId, facet).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning('an uncertain external session could not be reconciled', { threadId, cause: Cause.pretty(cause) }),
      ),
    );
  });

  readonly measure = Effect.fnUntraced(
    function* (this: SessionLifecycle, threadId: string, facet: ExternalSession) {
      const { terminals, evidence, requests, records } = this;
      const session = facet.session!;
      let execution: { readonly execution: string; readonly incarnation: number } | null = facet.execution;
      if (session.origin === 'adopted') {
        if (execution === null) return { _tag: 'Gone', failure: LOST_LINE } as const;
        const shell = yield* terminals.record(execution.execution, execution.incarnation);
        const ended = { _tag: 'Gone', failure: shellEndedLine(execution.execution) } as const;
        if (shell === null || (yield* terminals.lost(shell)) !== null) return ended;
        const state = yield* terminals.state(shell.execution);
        if (state === undefined || state.state.phase === 'ended') {
          return (yield* terminals.stopAsked(shell.execution)) ? ({ _tag: 'Closed' } as const) : ended;
        }
        const job =
          session.job === undefined
            ? 'unread'
            : yield* jobState(yield* evidence.processes(shell.execution), session.job, evidence.foreground(shell.execution));
        return job === 'gone' ? ({ _tag: 'Left' } as const) : standing;
      }
      if (execution === null) {
        const unlaunched = { _tag: 'Gone', failure: UNLAUNCHED_LINE } as const;
        if (session.cwd === null) return unlaunched;
        const projectId = yield* records.projectOf(threadId);
        if (projectId === undefined) return standing;
        const launch = yield* requests.request(projectId, harnessRunKey(session.id));
        if (launch._tag === 'Unknown') return unlaunched;
        if (launch._tag === 'Expired') return { _tag: 'Gone', failure: LOST_LINE } as const;
        if (launch._tag === 'Admitted' || (launch._tag === 'Settled' && launch.execution !== undefined)) execution = launch.execution!;
        else if (launch._tag === 'Settled') return unlaunched;
        else return standing;
      }
      const record = yield* terminals.record(execution.execution, execution.incarnation);
      if (record === null || (yield* terminals.lost(record)) !== null) return { _tag: 'Gone', failure: LOST_LINE } as const;
      const state = yield* terminals.state(record.execution);
      if (state === undefined) return { _tag: 'Gone', failure: LOST_LINE } as const;
      return state.state.phase === 'ended' ? ({ _tag: 'Exited', exit: state.state.nativeExit } as const) : standing;
    },
    Effect.mapError((cause) => (cause instanceof GateRefusal ? cause : threadCallFailed(cause))),
    Effect.timeoutOrElse({ duration: Duration.millis(executionHandshakeMs), orElse: () => Effect.succeed<Measured>(standing) }),
  );

  gone(threadId: string, session: HarnessSession, retiring: boolean | undefined): Effect.Effect<void, HarnessFailure> {
    return endsAbortedWhenGone(session, retiring)
      ? this.finish(threadId, session.id, 'aborted', null)
      : this.finish(threadId, session.id, 'failed', LOST_LINE, { stopWins: true });
  }

  readonly exited = Effect.fnUntraced(function* (
    this: SessionLifecycle,
    threadId: string,
    session: HarnessSession,
    exit: NativeExit | undefined,
    execution: HarnessExecutionRef | null,
  ) {
    const { terminals, finish } = this;
    const success = exit?._tag === 'Code' && exit.code === 0;
    const record =
      success || session.state === 'stopping' || execution === null
        ? null
        : yield* Effect.mapError(terminals.record(execution.execution, execution.incarnation), (cause) => threadCallFailed(cause));
    const closed =
      session.state === 'stopping' ||
      (record !== null && (yield* Effect.mapError(terminals.stopAsked(record.execution), (cause) => threadCallFailed(cause))));
    yield* finish(
      threadId,
      session.id,
      closed ? 'aborted' : success ? 'completed' : 'failed',
      closed || success ? null : exit === undefined ? 'The process ended without an exit receipt.' : exitLine(exit),
      { stopWins: true },
    );
  });
}
