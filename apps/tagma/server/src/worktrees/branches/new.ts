import { createHash } from 'node:crypto';
import { Effect } from 'effect';
import type { Git } from '@runlith/git/Git';
import { run, branchNameAt, commitOf, headAt, troubleOf } from '@runlith/git/repository';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { branchSlug, namedBranch } from '../contract/wire/creation.js';
import type { NewBranches } from '../contract/service/branches.js';

const HEAD_REFS = 'refs/heads/';

const slugOf = (name: string): string => branchSlug(name) || 'agent';

const hashOf = (text: string, length: number): string => createHash('sha256').update(text).digest('hex').slice(0, length);

const ancestorsOf = (branch: string): readonly string[] => {
  const parts = branch.split('/');
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
};

const unplaced = (reason: string): GateRefusal<'worktree-unavailable'> =>
  new GateRefusal('worktree-unavailable', reason, [
    'list_worktrees — what this project stands on',
    'start the thread where its parent stands: omit `worktree`',
  ]);

export function newBranches(git: Git['Service']): NewBranches['Service'] {
  const blocked = Effect.fn('NewBranches.blocked')(function* (path: string, branch: string) {
    const taken = yield* commitOf(git, path, `${HEAD_REFS}${branch}`).pipe(
      Effect.mapError(() => unplaced(`git could not read whether ${branch} is taken.`)),
    );
    if (taken !== null) return `${branch} already names a branch in this repository`;
    for (const ancestor of ancestorsOf(branch)) {
      const held = yield* commitOf(git, path, `${HEAD_REFS}${ancestor}`).pipe(
        Effect.mapError(() => unplaced(`git could not read whether ${ancestor} is taken.`)),
      );
      if (held !== null) return `${ancestor} already names a branch in this repository, so ${branch} cannot stand under it`;
    }
    const under = yield* run(git, path, ['for-each-ref', '--count=1', '--format=%(refname)', `${HEAD_REFS}${branch}/`], undefined).pipe(
      Effect.mapError((failure) => unplaced(`git could not read whether ${branch} heads another branch: ${troubleOf(failure)}`)),
    );
    const [leaf = ''] = under.trim().split('\n');
    if (leaf !== '') return `${branch} already heads ${leaf.slice(HEAD_REFS.length)}, so it cannot name a branch itself`;
    return null;
  });

  return {
    named: Effect.fn('NewBranches.named')(function* (path, prefix, name) {
      const wanted = namedBranch(prefix, name);
      const renamed: [string, string] = [
        'leave the name empty and the branch is named for you',
        'rename the worktree later: rename_worktree',
      ];
      if (wanted === '' || wanted === prefix)
        return yield* new GateRefusal('worktree-name-invalid', 'a branch needs a name after its prefix', renamed);
      const checked = yield* Effect.result(branchNameAt(git, path, wanted));
      if (checked._tag === 'Failure') {
        return checked.failure._tag === 'GitRefused'
          ? yield* new GateRefusal('worktree-name-invalid', troubleOf(checked.failure), ['name it as git names a branch', ...renamed])
          : yield* unplaced(`git could not check ${wanted} as a branch name: ${troubleOf(checked.failure)}`);
      }
      const reason = yield* blocked(path, checked.success);
      if (reason !== null) return yield* new GateRefusal('worktree-name-taken', `${reason}.`, ['choose another name', ...renamed]);
      return checked.success;
    }),
    generated: Effect.fn('NewBranches.generated')(function* (path, prefix, name, key) {
      const desired = `${prefix}${slugOf(name)}-${hashOf(key, 6)}`;
      const flattened = desired.replaceAll('/', '-');
      const candidates = flattened === desired ? [desired] : [desired, flattened];
      let last = '';
      for (const candidate of candidates) {
        const reason = yield* blocked(path, candidate);
        if (reason === null) return candidate;
        last = `${candidate} — ${reason}`;
      }
      return yield* new GateRefusal('worktree-name-taken', `No branch is free for this worktree: ${last}.`, [
        'try again: a new request names another branch',
      ]);
    }),
    start: Effect.fn('NewBranches.start')(function* (path) {
      const head = yield* headAt(git, path).pipe(Effect.mapError(() => unplaced(`git could not read where ${path} stands.`)));
      if (head.ref !== null && head.ref.startsWith(HEAD_REFS)) return head.ref.slice(HEAD_REFS.length);
      if (head.commit !== null) return head.commit;
      return yield* unplaced(`${path} stands on no commit yet, so there is nothing to cut a worktree from.`);
    }),
  };
}
