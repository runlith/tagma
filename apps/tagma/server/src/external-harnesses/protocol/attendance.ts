import { Cause, Clock, Duration, Effect, Fiber, FiberMap, Option, Schedule } from 'effect';
import { CurrentActivity, defected } from '@runlith/activity/Activity';
import { ActivityLog } from '@runlith/activity/log';
import { describeError } from '@runlith/utils/error';
import type { RunOwnership } from '@runlith/agent/thread/run/ThreadRunLedger';
import type { HostedResume, ThreadAbandonedRun } from '@runlith/agent/thread/storage/runs';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';
import { harnessSessionActive } from '../../threads/contract/wire/harness/session.js';
import { LEASE_RHYTHM } from '../../threads/contract/wire/rhythm.js';
import type { ThreadInbox } from '../../threads/store/inbox.js';
import type { HarnessLanes } from '../sessions/lanes.js';
import type { ProtocolRows } from '../store/protocol.js';
import type { HarnessSessionStore } from '../store/sessions.js';
import type { ProtocolEndings } from './endings.js';
import { ProtocolBeat } from './beat.js';
import { idleResource } from './idle.js';
import { facetOf, type ProtocolLinks } from './links.js';
import type { ProtocolProcess } from './process.js';
import type { ProtocolLaunches } from './launches.js';
import { freshRow, type ProtocolRow } from './row.js';

const unreadable = (failure: unknown): failure is GateRefusal => failure instanceof GateRefusal && failure.code === 'session-unreadable';

export class ProtocolAttendance {
  private readonly beat: ProtocolBeat;
  private readonly failures = new Map<string, string>();
  private readonly deaths = new Map<string, { readonly failure: string; readonly at: string }>();

  constructor(
    private readonly links: ProtocolLinks,
    private readonly process: ProtocolProcess,
    private readonly endings: ProtocolEndings,
    private readonly store: HarnessSessionStore,
    private readonly rows: ProtocolRows,
    private readonly inbox: ThreadInbox['Service'],
    private readonly ownership: RunOwnership,
    private readonly launches: ProtocolLaunches,
    private readonly lanes: HarnessLanes,
    private readonly fibers: FiberMap.FiberMap<string, void, never>,
    private readonly watchers: FiberMap.FiberMap<string, void, never>,
    private readonly recoveries: FiberMap.FiberMap<string, void, never>,
    private readonly clock: Clock.Clock,
    private readonly log: ActivityLog,
    private readonly idleMs: number,
    private readonly ownerId: string,
  ) {
    this.beat = new ProtocolBeat(links, store, ownerId);
  }

  driven(threadId: string): Effect.Effect<boolean> {
    return FiberMap.has(this.fibers, threadId);
  }

  died(threadId: string): { readonly failure: string; readonly at: string } | null {
    return this.deaths.get(threadId) ?? null;
  }

  hold(): Effect.Effect<never> {
    return Effect.forever(this.pulse());
  }

  private readonly pulse = Effect.fnUntraced(function* (this: ProtocolAttendance) {
    yield* Effect.sleep(LEASE_RHYTHM.heartbeatIntervalMs);
    const lost = yield* Effect.result(this.beat.tick());
    if (lost._tag === 'Failure') {
      return yield* Effect.logWarning('the protocol lease beat did not land; the next beat tries again', { failure: lost.failure });
    }
    for (const threadId of lost.success) yield* FiberMap.remove(this.fibers, threadId);
  });

  readonly ensure = Effect.fnUntraced(function* (this: ProtocolAttendance, threadId: string) {
    const { watchers, store, fibers } = this;
    yield* FiberMap.remove(watchers, threadId);
    const facet = yield* facetOf(store, threadId);
    if (harnessSessionActive(facet.session)) return yield* this.attend(threadId);
    const ending = yield* FiberMap.get(fibers, threadId).pipe(Effect.option);
    if (Option.isSome(ending) && Option.isSome(ending.value)) return yield* this.observe(threadId);
    yield* this.open(threadId);
  });

  private readonly open = Effect.fn('ProtocolAttendance.open')(function* (this: ProtocolAttendance, threadId: string) {
    const { store, ownerId, rows } = this;
    yield* Effect.uninterruptible(
      store.open(threadId, '', ownerId, () => Effect.succeed(null), {
        writes: rows.writes,
        run: (session, unit) =>
          Effect.flatMap(rows.read(unit, threadId), (carried) =>
            rows.write(unit, threadId, { ...freshRow(session.id, carried, null), rejections: 0 }),
          ),
      }),
    );
    yield* this.attend(threadId);
  });

  readonly stop = Effect.fnUntraced(function* (this: ProtocolAttendance, threadId: string, expectedId?: string) {
    const { rows, store, links, fibers, process } = this;
    const row = yield* rows.load(threadId);
    const marked = yield* store.change(threadId, (facet) => {
      const session = facet.session;
      const expected =
        expectedId === undefined || expectedId === session?.id || (row?.turns.some((turn) => turn.id === expectedId) ?? false);
      if (!harnessSessionActive(session) || !expected) return Effect.succeed({ facet, value: null });
      return Effect.succeed({ facet: { ...facet, session: { ...session, state: 'stopping' as const } }, value: facet });
    });
    if (marked === null) return 'not-running' as const;
    yield* this.attend(threadId);
    const link = links.get(threadId);
    const watching = yield* FiberMap.get(fibers, threadId).pipe(Effect.option);
    if (link !== undefined) yield* process.ending(link);
    if (Option.isSome(watching) && Option.isSome(watching.value)) yield* Fiber.await(watching.value.value);
    const standing = (yield* facetOf(store, threadId)).session;
    if (standing === undefined || standing.state === 'ended' || standing.id !== marked.session?.id) return 'stopped' as const;
    return yield* new GateRefusal('session-uncertain', 'The agent process ending is unknown.', [
      'read this session’s execution in the project’s terminal inventory and stop it there',
      'stop this session again once its execution answers',
    ]);
  });

  readonly watch = Effect.fnUntraced(function* (this: ProtocolAttendance) {
    for (const threadId of yield* this.store.standing('acp')) yield* this.observe(threadId);
  });

  readonly connect = Effect.fnUntraced(function* (this: ProtocolAttendance, threadId: string) {
    const { store, links, watchers } = this;
    const facet = yield* store.read(threadId);
    if (facet === null || !harnessSessionActive(facet.session) || facet.execution === null) return null;
    yield* FiberMap.remove(watchers, threadId);
    const attended = yield* this.attend(threadId).pipe(
      Effect.as(true),
      Effect.catchIf(
        (failure) => failure instanceof GateRefusal && failure.code === 'session-owned',
        () => Effect.as(this.observe(threadId), false),
      ),
    );
    if (!attended) return null;
    return yield* links.until(threadId, (link) => link ?? null).pipe(Effect.catchTag('LinkEnded', () => Effect.succeed(null)));
  });

  private observe(threadId: string): Effect.Effect<void> {
    const retrying = this.observed(threadId).pipe(
      Effect.tapError((failure) =>
        Effect.logWarning('a standing protocol resource could not be taken up; retrying at the next lease turn', { threadId, failure }),
      ),
      Effect.retry(Schedule.spaced(Duration.millis(LEASE_RHYTHM.takeoverAfterMs))),
      Effect.orDie,
    );
    return Effect.asVoid(FiberMap.run(this.watchers, threadId, this.attributed(retrying), { onlyIfMissing: true }));
  }

  private attributed<A, E>(work: Effect.Effect<A, E>): Effect.Effect<A, E> {
    return work.pipe(
      Effect.provideService(Clock.Clock, this.clock),
      Effect.provideService(ActivityLog, this.log),
      Effect.provideService(CurrentActivity, null),
    );
  }

  private recover(threadId: string, failure: string): Effect.Effect<void> {
    const recovered = this.ownership.dropped(threadId, failure).pipe(
      Effect.tapError((cause) =>
        Effect.logWarning('a run whose driver failed could not be handed to recovery; retrying at the next lease turn', {
          threadId,
          cause,
        }),
      ),
      Effect.retry(Schedule.spaced(Duration.millis(LEASE_RHYTHM.takeoverAfterMs))),
      Effect.orDie,
      Effect.flatMap((driven) =>
        driven ? Effect.void : Effect.andThen(Effect.sleep(LEASE_RHYTHM.takeoverAfterMs), this.observe(threadId)),
      ),
    );
    return Effect.asVoid(
      FiberMap.run(this.recoveries, threadId, this.attributed(recovered), { onlyIfMissing: true, startImmediately: false }),
    );
  }

  private readonly observed = Effect.fnUntraced(function* (this: ProtocolAttendance, threadId: string) {
    const { fibers, store, rows, process, idleMs, failures, recoveries } = this;
    for (;;) {
      const recovering = yield* FiberMap.get(recoveries, threadId);
      if (Option.isSome(recovering)) yield* Fiber.await(recovering.value);
      const driving = yield* FiberMap.get(fibers, threadId).pipe(Effect.option);
      if (Option.isSome(driving) && Option.isSome(driving.value)) {
        yield* Fiber.await(driving.value.value);
        if (!harnessSessionActive((yield* facetOf(store, threadId)).session)) {
          failures.delete(threadId);
          this.deaths.delete(threadId);
          if (this.launches.owing(threadId) === undefined && this.launches.compactionOwed(threadId) === undefined) return;
          yield* this.open(threadId);
          continue;
        }
        if (!failures.has(threadId)) yield* Effect.sleep(LEASE_RHYTHM.takeoverAfterMs);
        continue;
      }
      const facet = yield* facetOf(store, threadId);
      const session = facet.session;
      const failure = failures.get(threadId);
      failures.delete(threadId);
      if (failure !== undefined && harnessSessionActive(session) && (session.ownerId === null || session.ownerId === this.ownerId))
        return yield* this.recover(threadId, failure);
      if (!harnessSessionActive(session)) {
        this.deaths.delete(threadId);
        if (this.launches.owing(threadId) === undefined && this.launches.compactionOwed(threadId) === undefined) return;
        yield* this.open(threadId);
        continue;
      }
      const loaded = yield* Effect.result(rows.load(threadId));
      if (loaded._tag === 'Failure') return yield* unreadable(loaded.failure) ? this.attend(threadId) : Effect.fail(loaded.failure);
      const stored = loaded.success;
      const run = stored !== null && stored.turns.length > 0 ? stored : null;
      if (session.state !== 'running' || facet.execution === null) return run === null ? yield* this.attend(threadId) : undefined;
      if (run !== null) {
        if ((yield* this.parked(run)) || (yield* store.ended(run.turns.map((turn) => turn.id)))) return yield* this.attend(threadId);
        yield* process.exited(threadId);
        return (yield* this.parked(run)) ? yield* this.attend(threadId) : undefined;
      }
      if (stored !== null && process.stale(stored, facet.name)) return yield* this.attend(threadId);
      yield* idleResource(
        Effect.map(store.activeAt(threadId), (at) => Math.max(at, Date.parse(session.startedAt))),
        process.quiet(threadId),
        process.idle(threadId),
        idleMs,
      );
      return yield* this.attend(threadId);
    }
  });

  private parked(row: ProtocolRow): Effect.Effect<boolean, HarnessFailure> {
    return this.store.parked(row.turns.map((turn) => turn.id));
  }

  readonly adopt = Effect.fnUntraced(function* (this: ProtocolAttendance, run: ThreadAbandonedRun) {
    const { store, rows, ownership } = this;
    const facet = yield* store.read(run.threadId);
    if (!harnessSessionActive(facet?.session)) return 'declined' as HostedResume;
    const row = yield* rows.load(run.threadId);
    if (!(row?.turns.some((turn) => turn.id === run.id) ?? false)) return 'declined' as HostedResume;
    if (run.selector.kind === 'dropped' && (yield* FiberMap.has(this.fibers, run.threadId))) return 'ownership-lost' as HostedResume;
    const adoption = yield* ownership.adopt(run);
    if (adoption !== 'adopted') return adoption;
    yield* this.attend(run.threadId).pipe(
      Effect.catch((failure) => (failure instanceof GateRefusal && failure.code === 'session-owned' ? Effect.void : Effect.fail(failure))),
    );
    return 'adopted' as HostedResume;
  });

  readonly attend = Effect.fnUntraced(function* (this: ProtocolAttendance, threadId: string) {
    const { fibers, store, ownerId, ownership, process, endings, lanes, links, clock } = this;
    if (yield* FiberMap.has(fibers, threadId)) return;
    const now = yield* Clock.currentTimeMillis;
    const facet = yield* store.claim(threadId, ownerId, new Date(now - LEASE_RHYTHM.takeoverAfterMs));
    if (!harnessSessionActive(facet.session)) return;
    const session = facet.session;
    const attended = Effect.flatMap(ownership.resumeParked(threadId), ({ release }) =>
      process.drive(threadId, release).pipe(Effect.ensuring(Effect.sync(release))),
    ).pipe(
      Effect.catchIf(unreadable, (failure) => endings.unreadable(threadId, session.id, failure)),
      Effect.ensuring(lanes.close(session.id)),
      Effect.catchCause((cause) => (Cause.hasInterruptsOnly(cause) ? Effect.void : this.uncertain(threadId, session.id, cause))),
      Effect.ensuring(
        store
          .owned(threadId, session.id, ownerId, (current, held) => ({ ...current, session: { ...held, ownerId: null } }))
          .pipe(
            Effect.catchCause((cause) => Effect.logWarning('protocol session handover failed', { threadId, cause: Cause.pretty(cause) })),
          ),
      ),
      Effect.ensuring(Effect.sync(() => links.drop(threadId))),
      Effect.ensuring(Effect.suspend(() => this.observe(threadId))),
    );
    yield* FiberMap.run(fibers, threadId, Effect.provideService(attended, Clock.Clock, clock), { onlyIfMissing: true });
  });

  private uncertain(threadId: string, sessionId: string, cause: Cause.Cause<unknown>): Effect.Effect<void> {
    return Effect.flatMap(Clock.currentTimeMillis, (now) => {
      const failure = describeError(Cause.squash(cause));
      this.launches.drop(threadId);
      this.failures.set(threadId, failure);
      this.deaths.set(threadId, { failure, at: new Date(now).toISOString() });
      return this.attributed(defected(Cause.hasDies(cause) ? cause : Cause.die(Cause.squash(cause)), 'acp drive')).pipe(
        Effect.andThen(this.process.forsaken(threadId)),
        Effect.andThen(
          this.store.owned(threadId, sessionId, this.ownerId, (facet, session) => ({
            ...facet,
            session: { ...session, state: 'uncertain' },
          })),
        ),
        Effect.tap(() => Effect.logWarning('a protocol session is uncertain', { threadId, failure: Cause.pretty(cause) })),
        Effect.asVoid,
        Effect.catchCause((lost) =>
          Effect.logWarning('protocol session state could not be recorded', { threadId, cause: Cause.pretty(lost) }),
        ),
      );
    });
  }
}
