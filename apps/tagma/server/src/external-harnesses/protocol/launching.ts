import { Cause, Clock, Deferred, Effect, Exit } from 'effect';
import type { RunOwnership } from '@runlith/agent/thread/run/ThreadRunLedger';
import type { HostedResume, ThreadAbandonedRun } from '@runlith/agent/thread/storage/runs';
import { isCompactionRequest } from '@runlith/agent/thread/inboxItems';
import { LaunchFailed } from '@runlith/agent/thread/transport/contract';
import type { ThreadRow, ThreadRunRow } from '@runlith/agent/thread/rows';
import type { ThreadCompactionEntry } from '@runlith/agent/transcript/entries';
import type { LaunchGuidance, RunLaunch } from '@runlith/agent/thread/transport/contract';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { NativeStorage } from '../../threads/contract/service/engine.js';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';
import { harnessSessionActive } from '../../threads/contract/wire/harness/session.js';
import type { ThreadInbox } from '../../threads/store/inbox.js';
import type { ProtocolRows } from '../store/protocol.js';
import type { HarnessSessionStore } from '../store/sessions.js';
import type { ProtocolAttendance } from './attendance.js';
import type { ProtocolDelivery } from './delivery.js';
import type { ProtocolLaunches } from './launches.js';
import { facetOf, type ProtocolLinks } from './links.js';
import type { ProtocolJournal } from './journal.js';
import type { RunActivities } from './activities.js';
import type { ProtocolAlignment } from './alignment.js';
import { currentModel } from '../../threads/contract/wire/harness/observation.js';
import { WAITING_REASONS } from '../../threads/contract/wire/waiting.js';

export class ProtocolLaunching {
  constructor(
    private readonly launches: ProtocolLaunches,
    private readonly links: ProtocolLinks,
    private readonly attendance: ProtocolAttendance,
    private readonly delivery: ProtocolDelivery,
    private readonly store: HarnessSessionStore,
    private readonly rows: ProtocolRows,
    private readonly inbox: ThreadInbox['Service'],
    private readonly ownership: RunOwnership,
    private readonly threads: NativeStorage['Service']['threads'],
    private readonly runs: NativeStorage['Service']['runs'],
    private readonly guidance: LaunchGuidance,
    private readonly journal: ProtocolJournal,
    private readonly activities: RunActivities,
    private readonly alignment: ProtocolAlignment,
    private readonly ownerId: string,
  ) {}

  holds(runIds: readonly string[]): readonly string[] {
    return runIds.filter((runId) => this.launches.leads([runId]).length > 0 || this.links.turned(runId) || this.links.holdsInputs(runId));
  }

  compact(
    run: ThreadRunRow,
    keep: string | undefined,
    mode: ThreadCompactionEntry['mode'] = 'manual',
  ): Effect.Effect<void, HarnessFailure> {
    return Effect.suspend(() => {
      if (!this.launches.oweCompaction({ run, keep, mode })) return Effect.void;
      const flight = this.launches.pending(run.id)!;
      const opening = Effect.andThen(
        Effect.flatMap(this.threads.find(run.threadId), (thread) => this.opened(run, thread, [])),
        this.started(run.threadId, run.id),
      );
      return Effect.flatMap(Effect.raceFirst(Effect.as(opening, true), Effect.as(Deferred.await(flight.cancelled), false)), (ready) =>
        ready ? Effect.void : this.abandoned(run, Cause.interrupt()),
      ).pipe(
        Effect.tapCause((cause) =>
          Effect.andThen(
            Effect.sync(() => void this.launches.finish(run.id)),
            Effect.andThen(this.attendance.cancelOpening(run.threadId, run.id), this.abandoned(run, cause)),
          ).pipe(Effect.uninterruptible),
        ),
        Effect.ensuring(Effect.sync(() => this.launches.completed(run.id))),
      );
    });
  }

  readonly adopt = Effect.fnUntraced(function* (this: ProtocolLaunching, candidate: ThreadAbandonedRun) {
    if (candidate.selector.kind === 'dropped' && this.holds([candidate.id]).length > 0) return 'ownership-lost' as HostedResume;
    const row = yield* this.rows.load(candidate.threadId);
    if (!(row?.turns.some((turn) => turn.id === candidate.id) ?? false)) return yield* this.relaunch(candidate);
    const run = { id: candidate.id, threadId: candidate.threadId };
    this.journal.seed(run, (yield* this.runs(this.ownerId).runById(candidate.id))?.streamTail ?? []);
    const adopted = yield* this.attendance.adopt(candidate);
    if (adopted !== 'adopted') yield* this.journal.live(run, { op: 'close' });
    else yield* this.delivery.pump(candidate.threadId);
    return adopted;
  });

  private readonly relaunch = Effect.fnUntraced(
    function* (this: ProtocolLaunching, candidate: ThreadAbandonedRun) {
      const { ownership, threads, runs, ownerId, inbox, guidance } = this;
      const adoption = yield* ownership.adopt(candidate);
      if (adoption !== 'adopted') return adoption;
      const thread = yield* threads.find(candidate.threadId);
      const run = yield* runs(ownerId).runById(candidate.id);
      if (thread === undefined || run === null || run.status !== 'running') return 'declined' as HostedResume;
      const seed = (yield* inbox.pending(candidate.threadId)).filter(
        (item) => item.state === 'delivered' && item.deliveredToRunId === candidate.id,
      );
      if (run.kind === 'compaction') {
        const request = seed.find(isCompactionRequest);
        yield* this.compact(run, request?.body.keep, request?.body.mode);
        return 'adopted' as HostedResume;
      }
      yield* this.launch({ thread, run, oriented: false, outputOptional: false, seed, guidance });
      return 'adopted' as HostedResume;
    },
    Effect.mapError((failure) =>
      failure instanceof LaunchFailed ? new GateRefusal('launch-uncertain', failure.reason, ['read the thread state']) : failure,
    ),
  );

  launch(launch: RunLaunch): Effect.Effect<void, LaunchFailed> {
    return Effect.suspend(() => {
      if (!this.launches.owe(launch)) return Effect.void;
      const flight = this.launches.pending(launch.run.id)!;
      const opening = Effect.andThen(
        this.starting(
          launch.run,
          launch.thread,
          launch.seed.map((item) => item.id),
        ),
        this.started(launch.thread.id, launch.run.id),
      );
      return Effect.flatMap(Effect.raceFirst(Effect.as(opening, true), Effect.as(Deferred.await(flight.cancelled), false)), (ready) =>
        ready ? Effect.void : this.abandoned(launch.run, Cause.interrupt()),
      ).pipe(
        Effect.catchCause((cause) => {
          this.launches.finish(launch.run.id);
          return Effect.flatMap(Effect.exit(this.attendance.cancelOpening(launch.thread.id, launch.run.id)), (cleanup) => {
            const failure = Exit.isFailure(cleanup) ? Cause.combine(cause, cleanup.cause) : cause;
            return Effect.andThen(
              this.abandoned(launch.run, failure),
              Cause.hasInterruptsOnly(failure) ? Effect.interrupt : Effect.fail(new LaunchFailed({ reason: Cause.pretty(failure) })),
            );
          }).pipe(Effect.uninterruptible);
        }),
        Effect.ensuring(Effect.sync(() => this.launches.completed(launch.run.id))),
      );
    });
  }

  private started(threadId: string, runId: string): Effect.Effect<void, HarnessFailure> {
    return Effect.andThen(this.attendance.launch(threadId, runId), this.delivery.pump(threadId));
  }

  private readonly opened = Effect.fnUntraced(function* (
    this: ProtocolLaunching,
    run: ThreadRunRow,
    thread: ThreadRow | undefined,
    seed: readonly string[],
  ) {
    const facet = yield* facetOf(this.store, run.threadId);
    const asked = thread === undefined ? undefined : (yield* this.alignment.asked(thread)).asked;
    yield* this.activities.open(
      run.threadId,
      facet.name,
      { turn: run.id, model: asked?.model ?? currentModel(facet.observation), reasoning: asked?.reasoning ?? null },
      seed,
    );
    return facet;
  });

  private readonly starting = Effect.fnUntraced(function* (
    this: ProtocolLaunching,
    run: ThreadRunRow,
    thread: ThreadRow,
    seed: readonly string[],
  ) {
    if (harnessSessionActive((yield* this.opened(run, thread, seed)).session)) return;
    yield* this.journal.live(run, { op: 'phase', phase: 'opening', waiting: { reason: WAITING_REASONS.process, place: null } });
  });

  private abandoned(run: ThreadRunRow, cause: Cause.Cause<unknown>): Effect.Effect<void> {
    const interrupted = Cause.hasInterruptsOnly(cause);
    return Effect.flatMap(Clock.currentTimeMillis, (now) =>
      this.activities.end({
        turn: run.id,
        at: new Date(now).toISOString(),
        status: interrupted ? 'aborted' : 'failed',
        failure: interrupted ? null : Cause.pretty(cause),
        stoppedBy: null,
      }),
    );
  }
}
