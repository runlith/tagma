import { Clock, Effect } from 'effect';
import { settledEvent } from '@runlith/agent/thread/run/ThreadRunLedger';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { ThreadCallBroke } from '@runlith/agent/thread/ThreadBorder';
import type { AdapterReports, ReportPlan, ReportResult } from '@runlith/agent/thread/run/lifecycle/RunReports';
import type { ThreadRunLedger, ThreadRunRef, ThreadRunSettled } from '@runlith/agent/thread/run/ThreadRunLedger';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import { currentEffort, currentModel } from '../../threads/contract/wire/harness/observation.js';
import type { ActivityStart, RunActivities } from '../protocol/activities.js';
import type { ThreadWriteTx } from '@runlith/agent/thread/ThreadPorts';
import type { WriteUnit } from '../../platform/contract/service/units.js';
import type { WriteSet } from '../../platform/contract/service/writes.js';

const minted = (unit: WriteUnit<'machine'>): ThreadWriteTx => unit as unknown as ThreadWriteTx;
const startOf = (run: ThreadRunRef, facet: ExternalSession): ActivityStart => ({
  turn: run.id,
  model: currentModel(facet.observation),
  reasoning: currentEffort(facet.observation),
});

export class TerminalJournal {
  constructor(
    readonly reports: AdapterReports,
    readonly writes: WriteSet,
    private readonly activities: RunActivities,
    private readonly runs: ThreadRunLedger['Service'],
  ) {}

  readonly open = Effect.fn('TerminalJournal.open')(function* (
    this: TerminalJournal,
    run: ThreadRunRef,
    facet: ExternalSession,
    seed: readonly string[],
  ) {
    yield* this.activities.observe(run.threadId, facet.name, startOf(run, facet), seed);
    yield* this.reconcile(run.id);
  });

  readonly restore = Effect.fn('TerminalJournal.restore')(function* (this: TerminalJournal, run: ThreadRunRef, facet: ExternalSession) {
    yield* this.activities.open(run.threadId, facet.name, startOf(run, facet));
    yield* this.reconcile(run.id);
  });

  readonly settled = Effect.fn('TerminalJournal.settled')(function* (this: TerminalJournal, event: ThreadRunSettled) {
    if (this.activities.has(event.runId)) yield* this.reconcile(event.runId);
  });

  private readonly reconcile = Effect.fnUntraced(function* (this: TerminalJournal, runId: string) {
    const row = yield* this.runs.runById(runId);
    if (row === null) return yield* new ThreadCallBroke({ cause: new Error(`The activity run ${runId} has no row.`) });
    if (row.status === 'running') return;
    const event = settledEvent(row);
    yield* this.activities.end(
      {
        turn: event.runId,
        at: (row.finishedAt ?? new Date(yield* Clock.currentTimeMillis)).toISOString(),
        status:
          event.status === 'completed' ? 'completed' : event.status === 'aborted' || event.status === 'withdrawn' ? 'aborted' : 'failed',
        failure: event.failureReason,
        stoppedBy: event.stoppedBy,
      },
      row.usage,
    );
  });

  apply(unit: WriteUnit<'machine'>, plans: readonly ReportPlan[]): Effect.Effect<readonly ReportResult[], ThreadStorageFailed> {
    return Effect.forEach(plans, (plan) => plan.run(minted(unit))).pipe(
      Effect.mapError((cause) =>
        cause instanceof ThreadStorageFailed ? cause : new ThreadStorageFailed({ call: 'terminalJournal.apply', cause }),
      ),
    );
  }
}
