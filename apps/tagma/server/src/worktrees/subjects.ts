import { Effect } from 'effect';
import type { SubjectPlace } from '../platform/contract/service/place.js';
import { CallPlace } from '../platform/contract/service/place.js';
import { MachineUnits } from '../platform/contract/service/units.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { CheckoutPaths } from '../workspace/contract/service/checkoutPaths.js';
import type { RootId } from '../workspace/contract/wire/ids.js';
import { WorktreeRecords } from './contract/service/worktrees.js';

const worktreePlace = Effect.fn('worktrees.worktreePlace')(function* (named: string) {
  const here = yield* CallPlace;
  const root = yield* (yield* CheckoutPaths)
    .rootAcross(named, here?.projectId ?? null)
    .pipe(Effect.mapError((failure) => new GateRefusal('files', failure.reason, ['read the checkout again'])));
  if (root !== null) return { projectId: root.projectId, checkout: root.path, branch: null };
  const records = yield* WorktreeRecords;
  const record = yield* (yield* MachineUnits).read((unit) => records.byRoot(named as RootId, unit));
  if (record === null)
    return yield* new GateRefusal('not-found', `${named} is no worktree Tagma records.`, [
      'list_worktrees — the worktrees this project has',
    ]);
  return { projectId: record.projectId, checkout: null, branch: null };
});

export const WORKTREE_SUBJECTS: readonly SubjectPlace[] = [{ kind: 'worktree', place: worktreePlace }];
