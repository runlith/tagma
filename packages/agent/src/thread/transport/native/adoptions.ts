import { Deferred, Effect } from 'effect';
import type { ThreadQuestionEntry } from '../../../transcript/entries';
import type { HostedResume, ThreadAbandonedRun } from '../../storage/runs';
import type { ThreadBorderFailed } from '../../ThreadBorder';
import { budgetQueryOf, ThreadBudget, ThreadInbox, ThreadLeaseRhythm, ThreadResidency, ThreadStore } from '../../ThreadPorts';
import { RunAssembly } from '../../run/assembly/RunAssembly';
import { RunLifecycle } from '../../run/lifecycle/RunLifecycle';
import { RunAdmission } from '../../run/runAdmission';
import { RunExecution } from '../../run/RunExecution';
import { questionFromToolCalls } from '../../run/ThreadQuestion';
import { ThreadSnapshots } from '../../run/ThreadSnapshots';
import { NativeLaunches } from './launches';
import { QuestionIntake } from '../../run/scheduler/intake';
export type Adoption = HostedResume;
export const makeAdoptions = Effect.gen(function* () {
  const launches = yield* NativeLaunches;
  const store = yield* ThreadStore;
  const assembly = yield* RunAssembly;
  const execution = yield* RunExecution;
  const lifecycle = yield* RunLifecycle;
  const admission = yield* RunAdmission;
  const inbox = yield* ThreadInbox;
  const snapshots = yield* ThreadSnapshots;
  const budgets = yield* ThreadBudget;
  const lease = yield* ThreadLeaseRhythm;
  const residency = yield* ThreadResidency;
  const intake = yield* QuestionIntake;
  return {
    adopt: Effect.fnUntraced(function* (candidate: ThreadAbandonedRun): Effect.fn.Return<Adoption, ThreadBorderFailed> {
      if (candidate.kind !== 'turn') return 'declined' as const;
      const thread = yield* store.find(candidate.threadId);
      if (!thread) return 'declined' as const;
      const budget = yield* budgets.of(budgetQueryOf(thread));
      if (budget.remaining !== null && budget.remaining <= 0) return 'declined' as const;
      const entries = yield* store.entriesOfRun(candidate.threadId, candidate.id);
      const named = entries.length > 0 || (yield* inbox.pending(candidate.threadId)).length > 0;
      if (!named || !admission.admits(candidate.threadId)) return 'declined' as const;
      yield* residency.admit(thread);
      const adoption = yield* lifecycle.adopt(candidate).pipe(Effect.tapError(() => residency.release(thread.id)));
      if ('refused' in adoption) {
        yield* residency.release(thread.id);
        return adoption.refused;
      }
      const run = adoption.adopted;
      const adopted = (yield* store.find(candidate.threadId)) ?? thread;
      const parts = yield* assembly.adopted({ thread: adopted, run, transcript: entries });
      const settled = yield* parts.settle();
      if (settled.interactive.length > 0) {
        const parked = yield* parts.withDoor(
          Effect.fnUntraced(function* (door) {
            const question: ThreadQuestionEntry | null = yield* questionFromToolCalls(
              run,
              door,
              parts.catalog,
              settled.interactive.map((entry) => ({
                runId: run.id,
                toolCallId: entry.toolCallId,
                toolName: entry.toolName,
                input: entry.toolInput,
              })),
            );
            return yield* intake.park(run, question, door);
          }),
        );
        if (parked !== null) {
          yield* snapshots.publish(adopted.id);
          return 'adopted' as const;
        }
      }
      yield* execution.adopted({ id: run.id, threadId: adopted.id });
      const latest = (yield* store.find(adopted.id)) ?? adopted;
      const opened = yield* Deferred.make<void, ThreadBorderFailed>();
      yield* launches
        .launch(latest, run, { fresh: false, outputOptional: true, opened, oriented: false })
        .pipe(Effect.provideService(QuestionIntake, intake));
      yield* Deferred.await(opened).pipe(Effect.timeoutOption(lease.takeoverAfterMs));
      return 'adopted' as const;
    }),
  };
});
