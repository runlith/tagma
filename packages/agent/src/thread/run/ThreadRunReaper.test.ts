import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Deferred, Effect, Fiber, Layer } from 'effect';
import { TestClock } from 'effect/testing';
import { ActivityLog } from '@runlith/activity/log';
import { activityRecording } from '@runlith/activity/testing';
import { ThreadCallBroke } from '../ThreadBorder';
import type { ThreadRunRow } from '../rows';
import type { HostedResume, ThreadRunStorage } from '../storage/runs';
import type { ThreadRhythms, ThreadTx, ThreadWriteTx } from '../ThreadPorts';
import { lifecycleFixture } from '../conformance/runCycle/lifecycle';
import { recordingJournal } from '../conformance/runCycle/eventLog';
import { runRow } from '../conformance/runCycle/runDoubles';
import { runStore } from '../conformance/runCycle/store';
import { makeAggregateStorage } from '../storage/InMemoryAggregateStorage';
import { RunLifecycle } from './lifecycle/RunLifecycle';
import { threadRunLedgerLayer } from './ThreadRunLedger';
import { ThreadRunSettlements } from './ThreadRunSettlements';
import { RunScheduler } from './scheduler/RunScheduler';
import { ThreadRunReaper, threadRunReaperLayer } from './ThreadRunReaper';
const NOW = 10_000_000;
const rhythms: ThreadRhythms = {
  lease: { heartbeatIntervalMs: 1_000, staleRunningAfterMs: 60_000, takeoverAfterMs: 15_000 },
  reaper: { staleSweepIntervalMs: 600_000, recoveryBatch: 10, resumeWithinMs: 300_000, resumeAttemptLimit: 3 },
  settlement: {
    settledClaimAfterMs: 30_000,
    settledHeartbeatIntervalMs: 5_000,
    settledNotificationBatch: 10,
    settledNotifyAttemptLimit: 5,
  },
  streamFlushIntervalMs: 0,
};
const abandoned = (id: string, patch: Partial<ThreadRunRow> = {}) =>
  runRow(id, {
    threadId: `thread-of-${id}`,
    ownerId: 'departed',
    handedOverAt: new Date(NOW),
    heartbeatAt: new Date(NOW),
    ...patch,
  });
type RecoveryOptions = {
  readonly outcomes?: ReadonlyMap<string, HostedResume | ThreadCallBroke>;
  readonly rhythms?: ThreadRhythms;
  readonly journal?: ReturnType<typeof recordingJournal>;
};
const reaperWorld = Effect.fnUntraced(function* (runs: ThreadRunStorage<ThreadTx, ThreadWriteTx>, options: RecoveryOptions = {}) {
  const aggregate = makeAggregateStorage();
  const fixture = lifecycleFixture(runs, {
    journal: options.journal,
    rhythms: options.rhythms ?? rhythms,
    aggregate: { ...aggregate, metadata: (id) => Effect.succeed(aggregate.row(id)) },
  });
  const unread = () => Effect.die(new Error('Recovery does not use this scheduler operation.'));
  const scheduler = Layer.effect(
    RunScheduler,
    Effect.gen(function* () {
      const lifecycle = yield* RunLifecycle;
      return RunScheduler.of({
        admit: unread,
        resume: unread,
        withdraw: unread,
        queued: unread,
        launchBlocked: () => {
          throw new Error('Recovery does not read a launch gate.');
        },
        adopt: Effect.fnUntraced(function* (candidate) {
          const outcome = options.outcomes?.get(candidate.id);
          if (outcome instanceof ThreadCallBroke) return yield* outcome;
          if (outcome !== undefined) return outcome;
          const answer = yield* lifecycle.adopt(candidate);
          return 'adopted' in answer ? 'adopted' : answer.refused;
        }),
      });
    }),
  );
  const context = yield* Layer.build(
    threadRunReaperLayer.pipe(Layer.provideMerge(Layer.merge(scheduler, threadRunLedgerLayer)), Layer.provideMerge(fixture.layer)),
  );
  return {
    reaper: Context.get(context, ThreadRunReaper),
    settlements: Context.get(context, ThreadRunSettlements),
    journal: fixture.journal,
  };
});
describe('ThreadRunReaper', () => {
  it.effect(
    'a second recovery trigger joins the in-flight pass and receives the same decided count',
    Effect.fnUntraced(function* () {
      yield* TestClock.adjust(NOW);
      const { runs, rows } = runStore([abandoned('run-1')]);
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const storage: ThreadRunStorage<ThreadTx, ThreadWriteTx> = {
        ...runs,
        adoptRun: (id, patch, tx) =>
          Effect.andThen(Deferred.succeed(entered, undefined), Effect.andThen(Deferred.await(release), runs.adoptRun(id, patch, tx))),
      };
      const { reaper } = yield* reaperWorld(storage);
      const first = yield* Effect.forkScoped(reaper.recover());
      yield* Deferred.await(entered);
      const second = yield* Effect.forkScoped(reaper.recover(), { startImmediately: true });
      yield* Deferred.succeed(release, undefined);
      expect(yield* Fiber.join(first)).toBe(1);
      expect(yield* Fiber.join(second)).toBe(1);
      expect(rows.get('run-1')).toMatchObject({ ownerId: runs.ownerId, handedOverAt: null, status: 'running' });
    }),
  );
  it.effect(
    'declined adoption and an expired handover are cut while an accepted run changes owner',
    Effect.fnUntraced(function* () {
      yield* TestClock.adjust(NOW);
      const { runs, rows } = runStore([
        abandoned('adopted'),
        abandoned('declined'),
        abandoned('old', { handedOverAt: new Date(NOW - 90 * 60_000) }),
      ]);
      const { reaper, settlements } = yield* reaperWorld(runs, { outcomes: new Map([['declined', 'declined']]) });
      const settled: string[] = [];
      yield* settlements.subscribe({
        name: 'suite',
        handle: (event) =>
          Effect.sync(() => {
            settled.push(event.runId);
          }),
      });
      expect(yield* reaper.recover()).toBe(3);
      expect(rows.get('adopted')).toMatchObject({ ownerId: runs.ownerId, status: 'running' });
      expect(rows.get('declined')?.status).toBe('cut');
      expect(rows.get('old')?.status).toBe('cut');
      expect(settled.sort()).toEqual(['declined', 'old']);
    }),
  );
  it.effect(
    'one poisoned candidate stays available while the other candidate is adopted',
    Effect.fnUntraced(function* () {
      yield* TestClock.adjust(NOW);
      const { runs, rows } = runStore([abandoned('poisoned'), abandoned('fine')]);
      const { reaper } = yield* reaperWorld(runs, {
        outcomes: new Map([['poisoned', new ThreadCallBroke({ cause: new Error('the adoption refused') })]]),
      });
      expect(yield* reaper.recover()).toBe(1);
      expect(rows.get('poisoned')).toMatchObject({ status: 'running', ownerId: 'departed' });
      expect(rows.get('fine')).toMatchObject({ status: 'running', ownerId: runs.ownerId });
      expect((yield* reaper.abandonedRuns(new Date(NOW))).resumable.map((row) => row.id)).toEqual(['poisoned']);
    }),
  );
  it.effect(
    'a broken resume and a lost claim remain different observable outcomes',
    Effect.fnUntraced(function* () {
      yield* TestClock.adjust(NOW);
      const { runs } = runStore([abandoned('broken'), abandoned('taken')]);
      const outcomes = new Map<string, HostedResume | ThreadCallBroke>([
        ['broken', new ThreadCallBroke({ cause: new Error('the resume blew up') })],
        ['taken', 'ownership-lost'],
      ]);
      const { reaper } = yield* reaperWorld(runs, { outcomes });
      const recording = activityRecording();
      expect(yield* reaper.recover().pipe(Effect.provideService(ActivityLog, recording.log))).toBe(0);
      expect(recording.runNotes('broken')).toMatchObject([{ type: 'resume-failed', failure: 'the resume blew up' }]);
      expect(recording.runNotes('taken')).toMatchObject([{ type: 'ownership-lost' }]);
    }),
  );
  it.effect(
    'an abandoned run with a recorded stop ends aborted without trying the refused resumption',
    Effect.fnUntraced(function* () {
      yield* TestClock.adjust(NOW);
      const { runs, rows } = runStore([
        abandoned('stopped', { stopRequest: { by: 'reader', marker: true, withdraw: false, at: new Date(NOW).toISOString() } }),
      ]);
      const { reaper, settlements } = yield* reaperWorld(runs, {
        outcomes: new Map([['stopped', new ThreadCallBroke({ cause: new Error('This stopped run cannot resume.') })]]),
      });
      const settled: string[] = [];
      yield* settlements.subscribe({
        name: 'suite',
        handle: (event) =>
          Effect.sync(() => {
            settled.push(event.runId);
          }),
      });
      expect(yield* reaper.recover()).toBe(1);
      expect(rows.get('stopped')).toMatchObject({ status: 'aborted', settledBy: 'reader' });
      expect(settled).toEqual(['stopped']);
    }),
  );
  it.effect(
    'a poisoned stale ending rolls back and the sweep still settles the next run',
    Effect.fnUntraced(function* () {
      yield* TestClock.adjust(NOW);
      const beat = new Date(NOW - 60 * 60_000);
      const first = runRow('run-1', {
        heartbeatAt: beat,
        streamTail: [{ type: 'message', id: 'assistant:run-1', runId: 'run-1', role: 'assistant', text: 'Half a par' }],
      });
      const { runs, rows } = runStore([first, runRow('run-2', { threadId: 'thread-2', heartbeatAt: beat })]);
      const journal = recordingJournal((event) => event.threadId === first.threadId);
      const { reaper, settlements } = yield* reaperWorld(runs, { journal });
      const settled: string[] = [];
      yield* settlements.subscribe({
        name: 'suite',
        handle: (event) =>
          Effect.sync(() => {
            settled.push(event.runId);
          }),
      });
      expect(yield* reaper.recoverStaleRuns()).toBe(1);
      expect(rows.get(first.id)).toEqual(first);
      expect(rows.get('run-2')?.status).toBe('failed');
      expect(journal.rows.every((row) => row.threadId === 'thread-2')).toBe(true);
      expect(settled).toEqual(['run-2']);
    }),
  );
  it.effect(
    'the measured gap separates fresh, expired and future handovers',
    Effect.fnUntraced(function* () {
      yield* TestClock.adjust(NOW);
      const { runs } = runStore([
        abandoned('fresh', { handedOverAt: new Date(NOW - 60_000) }),
        abandoned('old', { handedOverAt: new Date(NOW - 90 * 60_000) }),
        abandoned('ahead', { handedOverAt: new Date(NOW + 5_000) }),
      ]);
      const { reaper } = yield* reaperWorld(runs);
      const found = yield* reaper.abandonedRuns(new Date(NOW));
      expect(found.resumable.map((row) => row.id)).toEqual(['fresh']);
      expect(found.cuttable.map((row) => row.id).sort()).toEqual(['ahead', 'old']);
    }),
  );
  it.effect(
    'one page combines handovers and foreign-owner silence, youngest gap first',
    Effect.fnUntraced(function* () {
      yield* TestClock.adjust(NOW);
      const { runs } = runStore([
        abandoned('stamped-old', { handedOverAt: new Date(NOW - 19 * 60_000) }),
        abandoned('silent-young', { handedOverAt: null, heartbeatAt: new Date(NOW - 40_000) }),
        abandoned('silent-old', { handedOverAt: null, heartbeatAt: new Date(NOW - 5 * 60_000) }),
      ]);
      const { reaper } = yield* reaperWorld(runs, { rhythms: { ...rhythms, reaper: { ...rhythms.reaper, recoveryBatch: 2 } } });
      const found = yield* reaper.abandonedRuns(new Date(NOW));
      expect([...found.resumable, ...found.cuttable].map((row) => row.id)).toEqual(['silent-young', 'silent-old']);
    }),
  );
  it.effect(
    'the owner clock drives takeover and the periodic stale sweep after their deadlines',
    Effect.fnUntraced(function* () {
      yield* TestClock.adjust(NOW);
      const { runs, rows } = runStore([
        abandoned('foreign', { handedOverAt: null }),
        runRow('local', { threadId: 'local-thread', heartbeatAt: new Date(NOW) }),
      ]);
      const { reaper } = yield* reaperWorld(runs);
      expect(yield* reaper.recover()).toBe(0);
      expect(rows.get('local')?.status).toBe('running');
      yield* TestClock.adjust(rhythms.lease.takeoverAfterMs + 1);
      expect(rows.get('foreign')).toMatchObject({ ownerId: runs.ownerId, status: 'running' });
      yield* TestClock.adjust(rhythms.reaper.staleSweepIntervalMs);
      expect(rows.get('local')?.status).toBe('failed');
    }),
  );
  it.effect(
    'closing the recovery scope cancels a pending takeover before it can claim a run',
    Effect.fnUntraced(function* () {
      yield* TestClock.adjust(NOW);
      const { runs, rows } = runStore([abandoned('foreign', { handedOverAt: null })]);
      yield* Effect.scoped(
        Effect.gen(function* () {
          const { reaper } = yield* reaperWorld(runs);
          expect(yield* reaper.recover()).toBe(0);
        }),
      );
      yield* TestClock.adjust(rhythms.lease.takeoverAfterMs + rhythms.reaper.staleSweepIntervalMs);
      expect(rows.get('foreign')).toMatchObject({ ownerId: 'departed', status: 'running' });
    }),
  );
});
