import { Effect } from 'effect';
import { branchConfigAt, headAt, setBranchConfigAt, upstreamAt } from '@runlith/git/repository';
import type { Git } from '@runlith/git/Git';

const KEPT = 'tagmaPushAs';

export const keptNameOf = (git: Git['Service'], dir: string, branch: string) => branchConfigAt(git, dir, branch, KEPT);

export const keepName = (git: Git['Service'], dir: string, branch: string, name: string | null) =>
  setBranchConfigAt(git, dir, branch, KEPT, name);

export const keptUpstream = Effect.fn('repositories.keptUpstream')(function* (git: Git['Service'], dir: string, branch: string) {
  const upstream = yield* upstreamAt(git, dir, branch);
  if (upstream === null || upstream.branch === branch) return null;
  return (yield* keptNameOf(git, dir, branch)) === upstream.branch ? upstream : null;
});

export const keptUpstreamHere = Effect.fn('repositories.keptUpstreamHere')(function* (git: Git['Service'], dir: string) {
  const head = yield* headAt(git, dir);
  const branch = head.ref?.startsWith('refs/heads/') === true ? head.ref.slice('refs/heads/'.length) : null;
  return branch === null ? null : yield* keptUpstream(git, dir, branch);
});
