import { Effect } from 'effect';
import type { Git } from '@runlith/git/Git';
import { indexPath, indexWrites } from '../../platform/git/index.js';
import { headRef, mergeParents } from '../../platform/git/publish.js';
import { openOperation } from '../../platform/git/places.js';
import { runGit } from '../../platform/git/ownGit.js';
import type { Intent } from '../store/intentLifecycle.js';
import { syncHeldIndex } from './indexSync.js';
import { concluded } from './publish.js';

export const recoverConclusion = (
  git: Git['Service'],
  hosted: Git['Service'],
  intent: Intent,
  commit: string,
): Effect.Effect<string | null> => {
  const merge = intent.merge;
  if (merge == null) return Effect.succeed(null);
  const root = intent.checkout;
  const finish = Effect.gen(function* () {
    if ((yield* headRef(git, root)) !== intent.ref)
      return 'the checkout moved off the recorded branch, so its merge tail was left untouched';
    const parents = (yield* runGit(git, 'merge-tail-parents', ['-C', root, 'show', '-s', '--format=%P', commit])).split(' ');
    if (parents.join('\n') !== [intent.base, ...merge.parents].join('\n'))
      return 'the landed tree does not have the recorded merge parents';
    const operation = yield* openOperation(git, root);
    if (operation !== null && operation !== 'merge') return `a ${operation} is in progress, so the earlier merge tail stays open`;
    if (operation === 'merge' && (yield* mergeParents(git, root)).join('\n') !== merge.parents.join('\n'))
      return 'another merge is open, so its state was left as it stood';
    const tip = yield* runGit(git, 'merge-tail-tip', ['-C', root, 'rev-parse', 'HEAD']);
    const paths = (yield* runGit(git, 'merge-tail-paths', [
      '-C',
      root,
      'diff-tree',
      '-r',
      '-z',
      '--name-only',
      '--no-renames',
      intent.base,
      commit,
    ]))
      .split('\0')
      .filter((path) => path !== '');
    const unsynced = yield* syncHeldIndex(git, root, [merge.tree], tip, paths, new Map(), '');
    const conclusion = operation === 'merge' ? yield* concluded(hosted, root, 'merge') : null;
    return conclusion ?? (unsynced.length === 0 ? null : `the merge index could not settle: ${unsynced.join(', ')}`);
  });
  return Effect.map(Effect.result(Effect.flatMap(indexPath(git, root), (index) => indexWrites.hold(index, finish))), (answer) => {
    if (answer._tag === 'Success') return answer.success;
    const failure = answer.failure;
    return failure._tag === 'OwnGitFailed' ? failure.message : `the merge tail's index lane did not finish: ${failure._tag}`;
  });
};
