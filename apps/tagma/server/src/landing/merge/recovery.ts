import { Effect } from 'effect';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import type { ProjectRoot, ProjectRootFailure } from '../../workspace/contract/wire/coverage.js';
import type { CheckoutRows } from '../../workspace/contract/service/checkouts.js';
import type { WorktreeRecords } from '../../worktrees/contract/service/worktrees.js';
import type { FinishingGate } from '../../worktrees/contract/service/retirement.js';
import { HEADS } from '../../worktrees/contract/service/finishingGate.js';
import type { MergeGit } from '../contract/service/mergeGit.js';
import type { MergeRecovery } from '../contract/service/merges.js';

type Unread = MergeRecovery['unread'][number];
type Aborted = { readonly aborted: readonly string[]; readonly unread: readonly Unread[] };

export const recoverMerges = (
  git: MergeGit['Service'],
  units: MachineUnits['Service'],
  records: WorktreeRecords['Service'],
  covered: (projectId: number) => Effect.Effect<readonly ProjectRoot[], ProjectRootFailure>,
  gate: FinishingGate['Service'],
  checkouts: CheckoutRows['Service'],
) =>
  Effect.fn('Merges.recover')(function* (): Effect.fn.Return<Aborted, StoreFailure> {
    const aborted: string[] = [];
    const unread: Unread[] = [];
    const projects = yield* units.read((unit) => records.liveProjects(unit));
    for (const projectId of projects) {
      const recorded = yield* Effect.result(units.read((unit) => records.records(projectId, unit)));
      const roots = yield* Effect.result(covered(projectId));
      if (recorded._tag === 'Failure') {
        unread.push({ projectId, path: null, reason: recorded.failure.message });
        continue;
      }
      if (roots._tag === 'Failure') {
        unread.push({ projectId, path: null, reason: roots.failure.message });
        continue;
      }
      for (const root of roots.success) {
        const held = yield* Effect.result(
          gate.hold(
            { kind: 'checkout', path: root.path },
            Effect.gen(function* () {
              const ours = yield* Effect.result(git.interrupted(root.path));
              if (ours._tag === 'Failure') return { reason: ours.failure.message };
              const interrupted = ours.success;
              if (
                interrupted === null ||
                !recorded.success.some(
                  (record) =>
                    interrupted.roots.includes(record.rootId) &&
                    record.baseBranch !== null &&
                    interrupted.ref === `${HEADS}${record.baseBranch}`,
                )
              )
                return null;
              const abort = yield* Effect.result(git.abort(root.path));
              return abort._tag === 'Success' ? { reason: null } : { reason: `the merge could not be aborted: ${abort.failure.message}` };
            }),
          ),
        );
        const ended = held._tag === 'Success' ? held.success : { reason: held.failure.message };
        if (ended === null) continue;
        if (ended.reason !== null) {
          unread.push({ projectId, path: root.path, reason: ended.reason });
          continue;
        }
        aborted.push(root.path);
        yield* checkouts.mark(root.rootId);
      }
    }
    return { aborted, unread };
  });
