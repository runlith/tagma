import { Clock, Effect } from 'effect';
import type { Git } from '@runlith/git/Git';
import { quietGit, runGit } from '../../platform/git/ownGit.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { Intent, IntentLifecycle } from '../store/intentLifecycle.js';
import type { PreparedMerge } from '../../change-record/contract/service/prepared.js';
import type { Lane } from '@runlith/held/Lane';
import { recoverConclusion } from './conclusion.js';

const OPEN_PAGE = 64;

const PRUNE_PAGE = 256;

const KEPT = 7 * 24 * 60 * 60 * 1000;

export type LandingIntents = {
  readonly intend: (
    key: string,
    projectId: number,
    root: string,
    base: string,
    tree: string,
    merge?: PreparedMerge,
    commit?: string,
    ref?: string,
  ) => Effect.Effect<void, StoreFailure>;
  readonly resume: (git: Git['Service'], hosted: Git['Service'], root: string) => Effect.Effect<readonly string[], StoreFailure>;
  readonly land: (key: string, commit: string) => Effect.Effect<boolean, StoreFailure>;
  readonly forget: (key: string) => Effect.Effect<void, StoreFailure>;
};

export type LandingRecovery = {
  readonly landed: readonly { readonly key: string; readonly commit: string }[];
  readonly forgotten: readonly string[];
  readonly lost: readonly { readonly key: string; readonly reason: string }[];
  readonly unread: readonly { readonly key: string; readonly reason: string }[];
  readonly pruned: number;
};

export const landingIntents = (lifecycle: IntentLifecycle): LandingIntents => ({
  intend: (key, projectId, root, base, tree, merge, commit, ref) =>
    Effect.flatMap(Clock.currentTimeMillis, (at) =>
      lifecycle.intend({
        key,
        kind: 'landing',
        projectId,
        phase: 'intended',
        repository: root,
        checkout: root,
        ref: ref ?? 'HEAD',
        base,
        tree,
        merge,
        commit: commit ?? null,
        witnessedAt: null,
        at: new Date(at),
      }),
    ),
  resume: (git, hosted, root) => resumeConclusions(lifecycle, git, hosted, root),
  land: (key, commit) => Effect.flatMap(Clock.currentTimeMillis, (at) => lifecycle.land(key, commit, new Date(at))),
  forget: (key) => lifecycle.forget(key),
});

type Found =
  | { readonly _tag: 'landed'; readonly commit: string }
  | { readonly _tag: 'absent' }
  | { readonly _tag: 'gone'; readonly reason: string }
  | { readonly _tag: 'unread'; readonly reason: string };

type Range =
  | { readonly _tag: 'read'; readonly children: ReadonlyMap<string, string>; readonly stacked: ReadonlyMap<string, string> }
  | { readonly _tag: 'gone'; readonly reason: string }
  | { readonly _tag: 'unread'; readonly reason: string };

const rangeOf = (git: Git['Service'], checkout: string, base: string): Effect.Effect<Range> =>
  Effect.map(
    Effect.result(runGit(git, 'landing-recovery', ['-C', checkout, 'log', '--format=%H%x00%T%x00%P', `${base}..HEAD`, '--'])),
    (answer): Range => {
      if (answer._tag === 'Failure') {
        return answer.failure.reason === 'not-a-repository'
          ? { _tag: 'gone', reason: answer.failure.message }
          : { _tag: 'unread', reason: answer.failure.message };
      }
      const children = new Map<string, string>();
      const stacked = new Map<string, string>();
      for (const line of answer.success.split('\n')) {
        const [sha = '', tree = '', parents = ''] = line.split('\0');
        if (parents.split(' ')[0] === base && !children.has(tree)) children.set(tree, sha);
        if (!stacked.has(tree)) stacked.set(tree, sha);
      }
      return { _tag: 'read', children, stacked };
    },
  );

const foundIn = (range: Range, intent: Intent): Found => {
  if (range._tag !== 'read') return range;
  const commit = range.children.get(intent.tree) ?? range.stacked.get(intent.tree);
  return commit === undefined ? { _tag: 'absent' } : { _tag: 'landed', commit };
};

const resumeConclusions = Effect.fn('landing.resumeConclusions')(function* (
  lifecycle: IntentLifecycle,
  git: Git['Service'],
  hosted: Git['Service'],
  root: string,
): Effect.fn.Return<readonly string[], StoreFailure> {
  const unread: string[] = [];
  let after: { readonly at: Date; readonly key: string } | null = null;
  for (;;) {
    const page: readonly Intent[] = yield* lifecycle.open('landing', after, OPEN_PAGE, root);
    for (const intent of page) {
      if (intent.merge == null || intent.commit === null) continue;
      const reachable = yield* Effect.result(
        quietGit(git, 'merge-tail-reach', ['-C', root, 'merge-base', '--is-ancestor', intent.commit, 'HEAD']),
      );
      if (reachable._tag === 'Failure') {
        unread.push(reachable.failure.message);
        continue;
      }
      if (reachable.success === null) continue;
      const reason = yield* recoverConclusion(git, hosted, intent, intent.commit);
      if (reason !== null) unread.push(reason);
      else yield* lifecycle.land(intent.key, intent.commit, new Date(yield* Clock.currentTimeMillis));
    }
    const last: Intent | undefined = page.at(-1);
    if (last === undefined || page.length < OPEN_PAGE) return unread;
    after = { at: last.at, key: last.key };
  }
});

export const recoverLandings = Effect.fn('landing.recover')(function* (
  lifecycle: IntentLifecycle,
  git: Git['Service'],
  startedAt: Date,
  commits?: Lane,
): Effect.fn.Return<LandingRecovery, StoreFailure> {
  const landed: { key: string; commit: string }[] = [];
  const forgotten: string[] = [];
  const lost: { key: string; reason: string }[] = [];
  const unread: { key: string; reason: string }[] = [];
  let after: { readonly at: Date; readonly key: string } | null = null;
  for (;;) {
    const page: readonly Intent[] = yield* lifecycle.open('landing', after, OPEN_PAGE);
    const before = page.filter((intent) => intent.at < startedAt);
    const ranges = new Map<string, Range>();
    for (const intent of before) {
      const at = `${intent.checkout}\0${intent.base}`;
      const range = ranges.get(at) ?? (yield* rangeOf(git, intent.checkout, intent.base));
      ranges.set(at, range);
      const found = foundIn(range, intent);
      if (found._tag === 'landed') {
        const repair = recoverConclusion(git, git, intent, found.commit);
        const repaired = yield* Effect.result(
          commits === undefined || intent.merge == null ? repair : commits.enter(intent.checkout, repair),
        );
        const reason =
          repaired._tag === 'Failure' ? `the merge tail's commit lane did not finish: ${repaired.failure._tag}` : repaired.success;
        if (reason !== null) unread.push({ key: intent.key, reason });
        else if (yield* lifecycle.land(intent.key, found.commit, new Date(yield* Clock.currentTimeMillis)))
          landed.push({ key: intent.key, commit: found.commit });
      } else if (found._tag === 'absent') {
        yield* lifecycle.forget(intent.key);
        forgotten.push(intent.key);
      } else if (found._tag === 'gone') {
        yield* lifecycle.forget(intent.key);
        lost.push({ key: intent.key, reason: found.reason });
      } else {
        unread.push({ key: intent.key, reason: found.reason });
      }
    }
    const last: Intent | undefined = page.at(-1);
    if (last === undefined || page.length < OPEN_PAGE || before.length < page.length) break;
    after = { at: last.at, key: last.key };
  }
  const cutoff = new Date(startedAt.getTime() - KEPT);
  let pruned = 0;
  for (;;) {
    const gone = yield* lifecycle.prune('landing', cutoff, PRUNE_PAGE);
    pruned += gone;
    if (gone < PRUNE_PAGE) break;
  }
  return { landed, forgotten, lost, unread, pruned };
});
