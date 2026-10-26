import { Clock, Deferred, Duration, Effect, FiberMap, Schedule } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { threadCallFailed, type HarnessFailure } from '../../threads/contract/service/failure.js';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import { harnessSessionActive } from '../../threads/contract/wire/harness/session.js';
import { LEASE_RHYTHM } from '../../threads/contract/wire/rhythm.js';
import type { TerminalEndings as ExecutionEndings } from '../../executions/contract/service/endings.js';
import type { Terminals } from '../../executions/contract/service/terminals.js';
import type { HarnessSessionStore } from '../store/sessions.js';
import type { TerminalEndings } from '../terminal/endings.js';

type Signal = Deferred.Deferred<'lost' | 'job'>;

export type Duty = (facet: ExternalSession, signal: Signal) => Effect.Effect<'again' | 'done', HarnessFailure>;

type Beating = { readonly sessionId: string; readonly signal: Signal; readonly duty: Duty; done: boolean };

type Held = Effect.Success<ReturnType<Terminals['Service']['record']>>;

type Attend = (threadId: string) => Effect.Effect<void, HarnessFailure>;

export class SessionLease {
  private readonly driven = new Map<string, Beating>();
  private readonly booted = new Map<string, Held>();

  constructor(
    private readonly store: HarnessSessionStore,
    private readonly terminals: Terminals['Service'],
    private readonly executionEndings: ExecutionEndings['Service'],
    private readonly endings: TerminalEndings,
    private readonly owners: FiberMap.FiberMap<string, void, never>,
    private readonly idle: FiberMap.FiberMap<string, void, never>,
    private readonly ownerId: string,
    private readonly attend: Attend,
  ) {}

  readonly recover = Effect.fn('SessionDriver.recover')(function* (this: SessionLease) {
    const { store, terminals, booted, idle } = this;
    booted.clear();
    const standing = yield* store.sessionsStanding('terminal');
    const handles = standing.flatMap(({ facet }) => (facet.execution === null ? [] : [facet.execution]));
    const found =
      handles.length === 0 ? new Map() : yield* Effect.mapError(terminals.recordsOf(handles), (cause) => threadCallFailed(cause));
    for (const { threadId, facet, running } of standing) {
      const record = facet.execution === null ? null : (found.get(facet.execution.execution) ?? null);
      const adopted = facet.session?.origin === 'adopted';
      if (running || adopted || record === null || facet.session?.state !== 'running') {
        if (facet.execution !== null && !adopted) booted.set(threadId, record);
        yield* this.takeUp(threadId);
        continue;
      }
      yield* FiberMap.run(idle, threadId, this.raisedAtEnd(threadId, record), { onlyIfMissing: true });
    }
    return standing;
  });

  readonly raise = (threadId: string): Effect.Effect<void, HarnessFailure> =>
    this.attend(threadId).pipe(
      Effect.catch((failure) =>
        failure instanceof GateRefusal && failure.code === 'session-owned'
          ? Effect.asVoid(FiberMap.run(this.owners, threadId, this.takeOverAtExpiry(threadId), { onlyIfMissing: true }))
          : Effect.fail(failure),
      ),
    );

  readonly heard = Effect.fnUntraced(function* (this: SessionLease, threadId: string) {
    const facet = yield* this.store.read(threadId);
    if (facet === null || facet.execution === null || facet.session?.state !== 'running') return;
    yield* this.raise(threadId);
  });

  reconciled(threadId: string): Held | undefined {
    const found = this.booted.has(threadId) ? (this.booted.get(threadId) ?? null) : undefined;
    this.booted.delete(threadId);
    return found;
  }

  readonly beaten = Effect.fnUntraced(function* <A>(
    this: SessionLease,
    threadId: string,
    sessionId: string,
    duty: Duty,
    watching: Effect.Effect<A, HarnessFailure>,
  ) {
    const signal = yield* Deferred.make<'lost' | 'job'>();
    const beating: Beating = { sessionId, signal, duty, done: false };
    this.driven.set(threadId, beating);
    const { driven } = this;
    return yield* Effect.ensuring(
      this.watched(threadId, beating, watching),
      Effect.sync(() => {
        if (driven.get(threadId)?.sessionId === sessionId) driven.delete(threadId);
      }),
    );
  });

  beating(): Effect.Effect<never> {
    return Effect.forever(this.pulse());
  }

  private readonly takeUp = Effect.fnUntraced(function* (this: SessionLease, threadId: string) {
    if (!(yield* this.attendUnlessOwned(threadId))) return;
    this.booted.delete(threadId);
    yield* FiberMap.run(this.owners, threadId, this.takeOverAtExpiry(threadId), { onlyIfMissing: true });
  });

  private readonly raisedAtEnd = Effect.fnUntraced(
    function* (this: SessionLease, threadId: string, record: NonNullable<Held>) {
      yield* this.executionEndings.decided({ projectId: record.projectId, execution: record.execution });
      yield* this.takeUp(threadId);
    },
    (effect, threadId) =>
      effect.pipe(
        Effect.tapError((failure) =>
          Effect.logWarning('an idle terminal session whose process ended could not be taken up; trying again at the next lease turn', {
            threadId,
            failure,
          }),
        ),
        Effect.retry(Schedule.spaced(Duration.millis(LEASE_RHYTHM.takeoverAfterMs))),
        Effect.orDie,
      ),
  );

  private attendUnlessOwned(threadId: string): Effect.Effect<boolean, HarnessFailure> {
    return this.attend(threadId).pipe(
      Effect.andThen(this.endings.resumed(threadId)),
      Effect.as(false),
      Effect.catch((failure) => {
        if (failure instanceof GateRefusal && failure.code === 'session-owned') return Effect.succeed(true);
        if (failure instanceof GateRefusal && failure.code === 'session-unreadable')
          return Effect.as(Effect.logWarning('external session recovery skipped unreadable row', { threadId }), false);
        return Effect.fail(failure);
      }),
    );
  }

  private readonly takeOverAtExpiry = Effect.fnUntraced(
    function* (this: SessionLease, threadId: string) {
      for (;;) {
        const session = (yield* this.store.read(threadId))?.session;
        if (!harnessSessionActive(session)) return;
        const expiresAt = Date.parse(session.heartbeatAt ?? session.startedAt) + LEASE_RHYTHM.takeoverAfterMs;
        const now = yield* Clock.currentTimeMillis;
        yield* Effect.sleep(Duration.millis(Math.max(expiresAt - now, 0) + 1));
        if (!(yield* this.attendUnlessOwned(threadId))) return;
      }
    },
    (effect, threadId) =>
      effect.pipe(
        Effect.tapError((failure) =>
          Effect.logWarning('a standing terminal session could not be taken up; trying again at the next lease turn', {
            threadId,
            failure,
          }),
        ),
        Effect.retry(Schedule.spaced(Duration.millis(LEASE_RHYTHM.takeoverAfterMs))),
        Effect.orDie,
      ),
  );

  private readonly watched = Effect.fnUntraced(function* <A>(
    this: SessionLease,
    threadId: string,
    beating: Beating,
    watching: Effect.Effect<A, HarnessFailure>,
  ) {
    const first = yield* this.store.read(threadId);
    if (first !== null && first.session?.id === beating.sessionId) beating.done = (yield* beating.duty(first, beating.signal)) === 'done';
    return yield* Effect.raceFirst(watching, Deferred.await(beating.signal));
  });

  private readonly beat = Effect.fn('SessionDriver.beat')(function* (this: SessionLease) {
    const { store, driven, ownerId } = this;
    const kept = new Set(yield* store.beat(ownerId, 'terminal', []));
    for (const [threadId, drive] of [...driven]) {
      if (!kept.has(threadId)) {
        yield* Deferred.succeed(drive.signal, 'lost');
        continue;
      }
      if (drive.done) continue;
      const current = yield* store.read(threadId);
      if (current === null || current.session?.id !== drive.sessionId) {
        yield* Deferred.succeed(drive.signal, 'lost');
        continue;
      }
      drive.done = (yield* drive.duty(current, drive.signal)) === 'done';
    }
  });

  private readonly pulse = Effect.fnUntraced(function* (this: SessionLease) {
    yield* Effect.sleep(LEASE_RHYTHM.heartbeatIntervalMs);
    const beat = yield* Effect.result(this.beat());
    if (beat._tag === 'Failure')
      yield* Effect.logWarning('the terminal lease beat did not land; the next beat tries again', { failure: beat.failure });
  });
}
