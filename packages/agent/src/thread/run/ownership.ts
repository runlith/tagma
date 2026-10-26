import { Effect } from 'effect';
import { ThreadOwner } from '../ThreadPorts';
import { THREAD_RUN_AWAITING_QUESTION_STAGE, type HostedResume } from '../storage/runs';
import { RunLifecycle } from './lifecycle/RunLifecycle';
import { RunControl } from './RunControl';
import { ROUTED_RESUMED } from './routedQuestions';
import { ThreadRunLedger, type RunOwnership } from './ThreadRunLedger';
import { ThreadRunReaper } from './ThreadRunReaper';

export const runOwnership: Effect.Effect<RunOwnership, never, RunControl | ThreadOwner | ThreadRunLedger | RunLifecycle | ThreadRunReaper> =
  Effect.gen(function* () {
    const ownerId = (yield* ThreadOwner).id;
    const ledger = yield* ThreadRunLedger;
    const lifecycle = yield* RunLifecycle;
    const control = yield* RunControl;
    const reaper = yield* ThreadRunReaper;
    return {
      launchable: control.launchable,
      dropped: (threadId, failure) => Effect.map(reaper.dropped(threadId, failure), (outcome) => outcome === 'adopted'),
      adopt: (candidate) =>
        Effect.map(lifecycle.adopt(candidate, ROUTED_RESUMED), (adoption): HostedResume =>
          'adopted' in adoption ? 'adopted' : adoption.refused,
        ),
      resumeParked: Effect.fnUntraced(function* (threadId) {
        const run = yield* ledger.activeRun(threadId);
        if (run?.progress.stage !== THREAD_RUN_AWAITING_QUESTION_STAGE || run.ownerId === ownerId)
          return { runId: null, release: () => {} };
        yield* lifecycle.resume(threadId, run.id, true);
        return { runId: run.id, release: control.launching(run) };
      }),
    };
  });
