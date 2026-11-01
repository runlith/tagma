import { Context, Effect, FiberMap, FiberSet, Layer, Schedule } from 'effect';
import type { ThreadAttachmentRef } from '../../../transcript/attachments';
import { isUnreadSteer } from '../../inboxItems';
import type { Keyed } from '../../keyed';
import type { ThreadMetadataRow, ThreadRow, ThreadRunRow } from '../../rows';
import type { ThreadInboxItem, ThreadInboxItemValues } from '../../storage/inbox';
import { type ThreadAbandonedRun, ThreadRunConflictError, type ThreadRunStartKey } from '../../storage/runs';
import { ThreadStorageFailed } from '../../persisted';
import { threadCauseOf, type ThreadBorderFailed } from '../../ThreadBorder';
import { ThreadEventJournal, ThreadInbox, ThreadLeaseRhythm, ThreadResting, ThreadStore, ThreadTransitions } from '../../ThreadPorts';
import { ThreadJournalLane } from '../../transition/lane';
import { ThreadEntryKinds, entryOf } from '../../../transcript/kinds';
import { RunGuidance } from '../RunGuidance';
import { WordsInFlight } from '../WordsInFlight';
import { idleWaitOf } from '../wordsWait';
import { RunAdmission } from '../runAdmission';
import { RunExecution, type RunResumption } from '../RunExecution';
import type { ThreadCompactAsk, ThreadCompactionAhead, ThreadCompactionAsked } from '../ThreadCompactionRuns';
import { ThreadRunLedger, settledOutcome, type ThreadRunRef, type ThreadRunSettled } from '../ThreadRunLedger';
import type { RunTerminalStatus } from '../../../transcript/live';
import { ThreadRunSettlements } from '../ThreadRunSettlements';
import { ThreadSnapshots } from '../ThreadSnapshots';
import { ThreadChanges } from '../ThreadChanges';
import { Transports } from '../../transport/Transports';
import type { WithdrawFailed, Withdrawal } from '../../transport/contract';
import type { HostedResume } from '../../storage/runs';
import type { ThreadStreamQuestionResult } from '../ThreadStreamSink';
import { makeCompactions } from './compactions';
import { QuestionRelaunch, type QuestionIntake } from './intake';
import { LaunchGate } from '../LaunchGate';
import { RunControl } from '../RunControl';
import { ThreadStopping } from '../ThreadStopping';
import { makeHandover } from './handover';
import {
  makeInputs,
  type ThreadInboxReadable,
  type ThreadInboxTurnOpener,
  type ThreadKeepWarmResult,
  type ThreadSaid,
  type ThreadSignalBehavior,
  type ThreadSignalInput,
  type ThreadSignalResult,
  type ThreadSteerInput,
  type ThreadTurnInput,
} from './inputs';
import { makeOpenings, type ThreadBegun } from './openings';
import { makeQueues } from './queue';
export type RunInput =
  | {
      readonly kind: 'say';
      readonly mode: 'send' | 'queue';
      readonly turn: ThreadTurnInput;
      readonly refs?: readonly ThreadAttachmentRef[];
    }
  | {
      readonly kind: 'steer';
      readonly input: ThreadSteerInput;
      readonly admitted?: Keyed;
    }
  | {
      readonly kind: 'signal';
      readonly input: ThreadSignalInput;
      readonly behavior?: ThreadSignalBehavior;
    }
  | {
      readonly kind: 'item';
      readonly item: ThreadInboxItem;
    }
  | {
      readonly kind: 'begin';
      readonly text: string;
      readonly start?: {
        readonly startKey: ThreadRunStartKey;
        readonly itemId: string;
      };
    }
  | {
      readonly kind: 'continue';
      readonly startKey?: ThreadRunStartKey;
    }
  | {
      readonly kind: 'keep-warm';
      readonly signalId: string;
    }
  | {
      readonly kind: 'compact';
      readonly ask: ThreadCompactAsk;
    }
  | {
      readonly kind: 'compact-ahead';
      readonly keep: string;
      readonly item: ThreadInboxItemValues;
      readonly startKey?: ThreadRunStartKey;
    };
export type RunSubject<I extends RunInput> = I extends {
  readonly kind: 'keep-warm' | 'compact' | 'compact-ahead';
}
  ? ThreadRow
  : ThreadMetadataRow;
export type ItemAdmitted = {
  readonly status: 'delivered' | 'queued' | 'woken' | 'stored';
  readonly runId: string | null;
  readonly acted?: false;
};
export type RunAdmitted = {
  readonly say: ThreadSaid;
  readonly steer: ThreadSaid;
  readonly signal: ThreadSignalResult;
  readonly item: ItemAdmitted;
  readonly begin: ThreadBegun;
  readonly continue: ThreadBegun;
  readonly 'keep-warm': ThreadKeepWarmResult;
  readonly compact: ThreadCompactionAsked;
  readonly 'compact-ahead': ThreadCompactionAhead;
};
export type ParkedResume<A> = {
  readonly answer: A;
  readonly relaunch: {
    readonly thread: ThreadRow;
    readonly questionResult: ThreadStreamQuestionResult;
  } | null;
};
export class RunScheduler extends Context.Service<
  RunScheduler,
  {
    admit<I extends RunInput>(thread: RunSubject<I>, item: I): Effect.Effect<RunAdmitted[I['kind']], ThreadBorderFailed>;
    resume<A>(
      run: ThreadRunRow,
      answering: (resumption: RunResumption) => Effect.Effect<ParkedResume<A>, ThreadBorderFailed>,
    ): Effect.Effect<A, ThreadBorderFailed, QuestionIntake>;
    adopt(candidate: ThreadAbandonedRun): Effect.Effect<HostedResume, ThreadBorderFailed>;
    withdraw(threadId: string, itemId: string): Effect.Effect<Withdrawal, ThreadBorderFailed | WithdrawFailed>;
    queued(threadId: string, run: ThreadRunRow): Effect.Effect<void, ThreadBorderFailed>;
    launchBlocked(threadId: string): boolean;
  }
>()('@runlith/agent/RunScheduler') {}
export const runSchedulerLayer = Layer.effect(
  RunScheduler,
  Effect.gen(function* () {
    const store = yield* ThreadStore;
    const inbox = yield* ThreadInbox;
    const ledger = yield* ThreadRunLedger;
    const snapshots = yield* ThreadSnapshots;
    const changes = yield* ThreadChanges;
    const execution = yield* RunExecution;
    const admission = yield* RunAdmission;
    const restingPort = yield* ThreadResting;
    const rests = (threadId: string): Effect.Effect<boolean, ThreadBorderFailed> =>
      restingPort === null ? Effect.succeed(false) : restingPort.resting(threadId);
    const summarizedHere = (run: ThreadAbandonedRun): Effect.Effect<boolean, ThreadBorderFailed> =>
      Effect.map(store.entriesOfRun(run.threadId, run.id), (entries) =>
        entries.some((entry) => entryOf('compaction')(entry) && entry.runId === run.id && entry.summarizer?.own === false),
      );
    const inflight = yield* WordsInFlight;
    const kernel = {
      store,
      log: yield* ThreadEventJournal,
      transitions: yield* ThreadTransitions,
      lane: yield* ThreadJournalLane,
      kinds: yield* ThreadEntryKinds,
    };
    const transports = yield* Transports;
    const relaunching = yield* QuestionRelaunch;
    const gate = yield* LaunchGate;
    const control = yield* RunControl;
    const stopping = yield* ThreadStopping;
    const starting = yield* FiberSet.make<void, never>();
    const handover = yield* makeHandover({ guidance: yield* RunGuidance, spawn: yield* FiberSet.runtime(starting)() });
    const openings = yield* makeOpenings({ kernel, handover });
    const compactions = yield* makeCompactions({ kernel, openings, handover });
    const queues = yield* makeQueues({ openings, compactions });
    const inputs = yield* makeInputs({ kernel, openings, queues, handover });
    const taken = (itemId: string): Effect.Effect<ItemAdmitted, ThreadBorderFailed> =>
      Effect.map(
        inbox.receipt(itemId),
        (standing) => ({ status: 'queued', runId: standing?.deliveredToRunId ?? null, acted: false }) as const,
      );
    const item = Effect.fnUntraced(function* (
      recipient: ThreadMetadataRow,
      given: ThreadInboxItem,
    ): Effect.fn.Return<ItemAdmitted, ThreadBorderFailed> {
      if (given.kind === 'envelope' && given.body.intent === 'report' && given.body.inReplyTo !== null) {
        const request = yield* inbox.receipt(given.body.inReplyTo);
        if (request?.kind === 'task' && request.body.reportDelivery === 'collect') {
          if (given.state === 'queued') {
            yield* Effect.uninterruptible(Effect.andThen(inbox.acknowledge([given.id], null), changes.publish(recipient.id)));
          }
          return { status: 'stored', runId: null };
        }
      }
      if (given.kind === 'task' && given.body.intent === 'interrupt') {
        const active = yield* ledger.activeRun(recipient.id);
        if (!active) {
          yield* inbox.acknowledge([given.id], null);
          return { status: 'stored', runId: null } as const;
        }
        const queued = yield* inputs.queue(recipient, given as ThreadInboxTurnOpener);
        if (queued === 'read') return yield* taken(given.id);
        if (!queued) {
          const woke = yield* inputs.wakeItem(recipient, given);
          return woke.status === 'woken' ? ({ status: 'woken', runId: woke.runId } as const) : ({ status: 'stored', runId: null } as const);
        }
        yield* stopping.stop(recipient, { door: 'interrupt-task', by: 'agent', expected: active.id });
        return { status: 'queued', runId: active.id } as const;
      }
      if ((yield* ledger.activeRun(recipient.id)) === null && (yield* rests(recipient.id))) {
        return { status: 'stored', runId: null } as const;
      }
      if (given.kind === 'task') {
        const queued = yield* inputs.queue(recipient, given as ThreadInboxTurnOpener);
        if (queued === 'read') return yield* taken(given.id);
        if (queued) return { status: 'queued', runId: queued.runId } as const;
        const woke = yield* inputs.wakeItem(recipient, given);
        return woke.status === 'woken' ? ({ status: 'woken', runId: woke.runId } as const) : ({ status: 'stored', runId: null } as const);
      }
      const delivery = yield* inputs.send(recipient, given as ThreadInboxReadable, { ifActive: 'deliver', ifIdle: 'wake' });
      if (delivery.status === 'delivered') return { status: 'delivered', runId: delivery.runId } as const;
      if (delivery.status === 'queued') return { status: 'queued', runId: delivery.runId } as const;
      if (delivery.status === 'woken') return { status: 'woken', runId: delivery.runId } as const;
      return { status: 'stored', runId: delivery.status === 'persisted' ? (delivery.runId ?? null) : null } as const;
    });
    const rowed = <A>(
      thread: ThreadMetadataRow | ThreadRow,
      use: (row: ThreadRow) => Effect.Effect<A, ThreadBorderFailed>,
    ): Effect.Effect<A, ThreadBorderFailed> =>
      'history' in thread ? use(thread) : Effect.die(new Error(`Thread ${thread.id} was admitted without its row.`));
    function admit<I extends RunInput>(thread: RunSubject<I>, input: I): Effect.Effect<RunAdmitted[I['kind']], ThreadBorderFailed>;
    function admit(
      thread: ThreadMetadataRow | ThreadRow,
      input: RunInput,
    ): Effect.Effect<RunAdmitted[RunInput['kind']], ThreadBorderFailed> {
      if (input.kind === 'say' || input.kind === 'steer' || input.kind === 'begin' || input.kind === 'continue') gate.lift(thread.id);
      switch (input.kind) {
        case 'say':
          return inputs.say(thread, input.mode, input.turn, input.refs);
        case 'steer':
          return inputs.steer(thread, input.input, input.admitted);
        case 'signal':
          return inputs.sendSignal(thread, input.input, input.behavior);
        case 'item':
          return item(thread, input.item);
        case 'begin':
          return Effect.gen(function* () {
            const going = input.start === undefined ? yield* ledger.activeRun(thread.id) : null;
            if (going) return { runId: going.id, acted: false };
            return yield* inputs.begin(thread, input.text, input.start);
          });
        case 'continue':
          return queues.continue(thread.id, thread.ownerId, input.startKey);
        case 'keep-warm':
          return rowed(thread, (row) => inputs.keepWarm(row, input.signalId));
        case 'compact':
          return rowed(thread, (row) => compactions.ask(row, input.ask));
        case 'compact-ahead':
          return rowed(thread, (row) => compactions.ahead(row, input.keep, input.item, input.startKey));
      }
    }
    const waits = { resting: restingPort, gate, inflight };
    const wakeAfter = Effect.fnUntraced(function* (
      threadId: string,
      runId: string,
      status: RunTerminalStatus,
    ): Effect.fn.Return<void, ThreadBorderFailed> {
      if ((yield* idleWaitOf(waits, threadId, runId)) !== null) return yield* snapshots.publish(threadId);
      const thread = yield* store.metadata(threadId);
      if (thread === undefined) return;
      if (yield* compactions.recover(thread, runId)) return;
      yield* queues.next(thread, runId, status === 'aborted').pipe(
        Effect.retry({ times: 1, while: (failure) => failure instanceof ThreadStorageFailed }),
        Effect.catchIf(
          (failure) => threadCauseOf(failure) instanceof ThreadRunConflictError,
          (failure) => Effect.logInfo('another opener holds the thread; the queued words wait for its run to settle', { runId, failure }),
        ),
      );
      yield* snapshots.publish(threadId);
    });
    const rhythm = yield* ThreadLeaseRhythm;
    const releases = yield* FiberMap.make<string, void, never>();
    const letGo = (run: ThreadRunRef): boolean => {
      if (!inflight.live(run.id)) return true;
      if (control.holder(run.id) !== undefined) return false;
      inflight.returned(run);
      return true;
    };
    const followUp = Effect.fnUntraced(function* (event: ThreadRunSettled): Effect.fn.Return<void, ThreadBorderFailed> {
      const run = { id: event.runId, threadId: event.threadId };
      if (inflight.live(run.id)) {
        if (letGo(run)) return;
        yield* FiberMap.run(
          releases,
          run.id,
          Effect.repeat(
            Effect.sync(() => letGo(run)),
            {
              while: (done) => !done,
              schedule: Schedule.spaced(rhythm.heartbeatIntervalMs),
            },
          ).pipe(Effect.asVoid),
          { onlyIfMissing: true },
        );
        return yield* snapshots.publish(run.threadId);
      }
      const latest = yield* ledger.latestRun(event.threadId);
      const status = settledOutcome(event);
      if (latest?.id !== event.runId || (status === 'cut' && event.kind !== 'compaction')) return yield* snapshots.publish(event.threadId);
      yield* wakeAfter(event.threadId, event.runId, status);
    });
    const drained = Effect.fnUntraced(function* (run: ThreadRunRef): Effect.fn.Return<void, ThreadBorderFailed> {
      const latest = yield* ledger.latestRun(run.threadId);
      if (latest === null || latest.id !== run.id || latest.status === 'running' || latest.status === 'cut') return;
      yield* wakeAfter(run.threadId, latest.id, latest.kind === 'keep-warm' ? 'completed' : latest.status);
    });
    yield* (yield* ThreadRunSettlements).subscribe({
      name: 'follow-up wake',
      at: 'first',
      handle: followUp,
    });
    yield* (yield* ThreadRunSettlements).subscribe({
      name: 'compaction waiters',
      handle: (event) => compactions.ended(event.runId),
    });
    const settling = yield* FiberSet.make<void, ThreadBorderFailed>();
    const settle = yield* FiberSet.runtime(settling)();
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        inflight.onDrained((run) => {
          settle(
            drained(run).pipe(
              Effect.tapCause((cause) => Effect.logWarning('words settled after their run did not open the next one', { run, cause })),
            ),
          );
        }),
      ),
      (unsubscribe) => Effect.sync(unsubscribe),
    );
    const lifted = yield* FiberSet.make<string | null, ThreadBorderFailed>();
    const open = yield* FiberSet.runtime(lifted)();
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        admission.onLift((threadId) => {
          open(
            Effect.flatMap(rests(threadId), (resting) => (resting ? Effect.succeed(null) : queues.waiting(threadId))).pipe(
              Effect.tapCause((cause) => Effect.logWarning('words kept for a lifted admission did not open', { threadId, cause })),
            ),
          );
        }),
      ),
      (unsubscribe) => Effect.sync(unsubscribe),
    );
    return RunScheduler.of({
      admit,
      resume: (run, answering) =>
        Effect.suspend(() => {
          const answered = control.launching(run);
          return execution
            .resume(
              run,
              Effect.fnUntraced(
                function* (resumption) {
                  const resumed = yield* answering(resumption);
                  if (resumed.relaunch !== null && !resumption.halt.stopped) {
                    yield* relaunching.relaunch(resumed.relaunch.thread, run, resumed.relaunch.questionResult);
                  }
                  return resumed.answer;
                },
                (effect, resumption) => effect.pipe(Effect.ensuring(Effect.sync(answered))),
              ),
            )
            .pipe(Effect.onError(() => Effect.sync(answered)));
        }),
      adopt: Effect.fnUntraced(function* (candidate) {
        const thread = yield* store.find(candidate.threadId);
        if (!thread) return 'declined' as const;
        const transport = yield* Effect.option(transports.of(thread.transport));
        if (transport._tag === 'None') return 'declined' as const;
        if (candidate.kind === 'compaction' && (thread.capabilities.compaction === 'foreign' || (yield* summarizedHere(candidate))))
          return 'declined' as const;
        const adopting = control.launching(candidate);
        return yield* transport.value.runs.adopt(candidate).pipe(Effect.ensuring(Effect.sync(adopting)));
      }),
      withdraw: Effect.fnUntraced(function* (threadId, itemId) {
        const thread = yield* store.metadata(threadId);
        const active = yield* ledger.activeRun(threadId);
        const given = yield* inbox.receipt(itemId);
        if (thread === undefined || active === null || given === undefined || !isUnreadSteer(given)) return 'unsent' as const;
        return yield* handover.withdraw(thread, active, given);
      }),
      queued: Effect.fnUntraced(function* (threadId, run) {
        const thread = yield* store.metadata(threadId);
        if (thread !== undefined) yield* handover.queued(thread, run);
      }),
      launchBlocked: (threadId) => gate.blocked(threadId),
    });
  }),
);
