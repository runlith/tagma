import { troubleOf, headAt } from '@runlith/git/repository';
import { Git } from '@runlith/git/Git';
import { Effect } from 'effect';
import { actingGit } from '../../platform/git/ownGit.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';

export const branchAt = Effect.fn('enforcement.branchAt')(function* (root: string) {
  const head = yield* headAt(actingGit(yield* Git, 'enforcement-head'), root).pipe(
    Effect.mapError(
      (failure) =>
        new GateRefusal('inspection-failed', `git could not say which branch ${root} stands on: ${troubleOf(failure)}`, [
          'read_checkout says whether git can read this checkout',
        ]),
    ),
  );
  return head.ref?.startsWith('refs/heads/') === true ? head.ref.slice('refs/heads/'.length) : null;
});
