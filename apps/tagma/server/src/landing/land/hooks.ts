import { access, constants, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Data, Effect, Ref } from 'effect';
import type { Git } from '@runlith/git/Git';
import type { HoldCut, HoldStalled } from '@runlith/held/failures';
import { type CommitTrees, type TreePlace, WHOLE_TREE } from '../../workspace/contract/service/commitTrees.js';
import { OwnGitFailed, quietGit, runGit } from '../../platform/git/ownGit.js';
import type { GitPlaces } from '../../platform/git/places.js';
import type { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { RefusedEdits } from './reshaping.js';
import type { Reshaped } from '../../change-record/contract/wire/reshape.js';
import { CHAINED, passesOwnGit } from '../../enforcement/contract/wire/gateHook.js';

const HOOKS = ['pre-commit', 'pre-merge-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit', 'post-merge'] as const;

type Hook = (typeof HOOKS)[number];

export type HookKind = { readonly verify: Hook; readonly source: string; readonly landed: Hook; readonly args: readonly string[] };

export const COMMITTING: HookKind = { verify: 'pre-commit', source: 'message', landed: 'post-commit', args: [] };

export const MERGING: HookKind = { verify: 'pre-merge-commit', source: 'merge', landed: 'post-merge', args: ['0'] };

export type Committing = {
  readonly tree: string;
  readonly left: string;
  readonly message: string;
  readonly sign: boolean;
  readonly after: ReadonlySet<Hook>;
};

const runnable = (path: string): Promise<boolean> =>
  access(path, constants.X_OK).then(
    () => true,
    () => false,
  );

const acting = async (directory: string, hook: Hook): Promise<boolean> => {
  const path = join(directory, hook);
  if (!(await runnable(path))) return false;
  if (await runnable(`${path}${CHAINED}`)) return true;
  return !passesOwnGit(hook, await readFile(path, 'utf8').catch(() => ''));
};

const presentAt = (directory: string): Promise<ReadonlySet<Hook>> =>
  Promise.all(HOOKS.map((hook) => acting(directory, hook).then((acts) => (acts ? hook : null)))).then(
    (found) => new Set(found.filter((hook): hook is Hook => hook !== null)),
  );

const run = (git: Git['Service'], place: TreePlace, hooks: string, hook: Hook, args: readonly string[]) =>
  Effect.mapError(
    runGit(
      git,
      `submit-hook-${hook}`,
      [
        '-C',
        place.dir,
        '-c',
        `core.hooksPath=${hooks}`,
        'hook',
        'run',
        '--ignore-missing',
        hook,
        ...(args.length === 0 ? [] : ['--', ...args]),
      ],
      {
        env: { ...place.env, GIT_EDITOR: ':' },
        configured: true,
      },
    ),
    (failure) =>
      failure.reason === 'hook-unsupported'
        ? new OwnGitFailed({
            op: failure.op,
            message: `this checkout has a ${hook} hook, and running it needs git 2.36 or later; git said: ${failure.message}`,
            ran: true,
          })
        : failure,
  );

export class HookRefused extends Data.TaggedError('HookRefused')<{
  readonly failure: OwnGitFailed | GateRefusal | StoreFailure | HoldCut;
  readonly built: string;
  readonly left: string;
  readonly unread: string | null;
  readonly earlier: RefusedEdits | null;
  readonly stepped: readonly Reshaped[];
}> {}

export const withSteps =
  (stepped: readonly Reshaped[]) =>
  <E>(failure: E | HookRefused): E | HookRefused =>
    failure instanceof HookRefused
      ? new HookRefused({
          failure: failure.failure,
          built: failure.built,
          left: failure.left,
          unread: failure.unread,
          earlier: failure.earlier,
          stepped,
        })
      : failure;

export const formedRefusal =
  (tree: string, stepped: readonly Reshaped[]) =>
  <E extends GateRefusal>(failure: E): E | HookRefused =>
    stepped.length === 0 ? failure : new HookRefused({ failure, built: tree, left: tree, unread: null, earlier: null, stepped });

const whitespace = (message: string): string => {
  const lines = message.split('\n').map((line) => line.replace(/\s+$/, ''));
  const kept: string[] = [];
  for (const line of lines) {
    if (line === '' && (kept.length === 0 || kept.at(-1) === '')) continue;
    kept.push(line);
  }
  while (kept.at(-1) === '') kept.pop();
  return kept.length === 0 ? '' : `${kept.join('\n')}\n`;
};

const TRUE = new Set(['', 'true', 'yes', 'on', '1']);

export type CommitConfig = { readonly cleanup: string | null; readonly sign: boolean };

export const commitConfig = (git: Git['Service'], root: string): Effect.Effect<CommitConfig, OwnGitFailed> =>
  Effect.map(
    quietGit(git, 'submit-config', ['-C', root, 'config', '--get-regexp', '^commit\\.(cleanup|gpgsign)$'], { configured: true }),
    (listed) => {
      let cleanup: string | null = null;
      let sign = false;
      for (const line of (listed ?? '').split('\n')) {
        const space = line.indexOf(' ');
        const name = (space === -1 ? line : line.slice(0, space)).toLowerCase();
        const value = space === -1 ? '' : line.slice(space + 1);
        if (name === 'commit.cleanup') cleanup = value;
        if (name === 'commit.gpgsign') sign = TRUE.has(value.toLowerCase());
      }
      return { cleanup, sign };
    },
  );

const cleaned = (git: Git['Service'], root: string, message: string, mode: string | null): Effect.Effect<string, OwnGitFailed> => {
  if (mode === 'verbatim') return Effect.succeed(message);
  if (mode === 'strip')
    return runGit(git, 'submit-stripspace', ['-C', root, 'stripspace', '--strip-comments'], { stdin: message }).pipe(
      Effect.map((out) => (out === '' ? '' : `${out}\n`)),
    );
  return Effect.succeed(whitespace(message));
};

type Ran = {
  readonly failure: OwnGitFailed | null;
  readonly staged: string;
  readonly left: string;
  readonly said: string;
  readonly unread: string | null;
};

type Left = { readonly left: string; readonly unread: string | null };

const file = <A>(op: string, act: () => Promise<A>) =>
  Effect.tryPromise({
    try: act,
    catch: (cause) => new OwnGitFailed({ op, message: cause instanceof Error ? cause.message : String(cause), ran: false }),
  });

const said = (
  hosted: Git['Service'],
  place: TreePlace,
  hooks: string,
  present: ReadonlySet<Hook>,
  message: string,
  kind: HookKind,
): Effect.Effect<string, OwnGitFailed> => {
  if (!present.has('prepare-commit-msg') && !present.has('commit-msg')) return Effect.succeed(message);
  return Effect.acquireUseRelease(
    file('submit-message-place', () => mkdtemp(join(tmpdir(), 'tagma-message-'))),
    (dir) =>
      Effect.gen(function* () {
        const editing = join(dir, 'COMMIT_EDITMSG');
        yield* file('submit-message-write', () => writeFile(editing, message));
        if (present.has('prepare-commit-msg')) yield* run(hosted, place, hooks, 'prepare-commit-msg', [editing, kind.source]);
        if (present.has('commit-msg')) yield* run(hosted, place, hooks, 'commit-msg', [editing]);
        return yield* file('submit-message-read', () => readFile(editing, 'utf8'));
      }),
    (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
  );
};

const leftOf = Effect.fnUntraced(function* (git: Git['Service'], trees: CommitTrees['Service'], place: TreePlace, built: string) {
  const read = yield* Effect.result(
    Effect.gen(function* () {
      const index = yield* trees.staged(git, place);
      const unstaged = yield* trees.unstaged(git, place);
      return unstaged.length === 0 ? index : yield* trees.taken(git, place, unstaged);
    }),
  );
  if (read._tag === 'Success') return { left: read.success, unread: null } satisfies Left;
  const worked = yield* Effect.result(trees.worked(git, place, built));
  if (worked._tag === 'Failure') return { left: built, unread: `${read.failure.message}; ${worked.failure.message}` } satisfies Left;
  yield* Effect.logWarning('the files a hook left staged could not be read, so the worked tree stands in for them', {
    reason: read.failure.message,
  });
  return { left: worked.success, unread: null } satisfies Left;
});

const hooked = (
  git: Git['Service'],
  hosted: Git['Service'],
  trees: CommitTrees['Service'],
  root: string,
  places: GitPlaces,
  present: ReadonlySet<Hook>,
  built: string,
  message: string,
  kind: HookKind,
  started: Ref.Ref<boolean>,
) =>
  trees.within(git, root, places.gitDir, built, WHOLE_TREE, (place) =>
    Effect.gen(function* () {
      yield* Ref.set(started, true);
      const verifying = present.has(kind.verify);
      const ran = verifying ? yield* Effect.result(run(hosted, place, places.hooks, kind.verify, [])) : null;
      if (ran?._tag === 'Failure') {
        const read = yield* leftOf(git, trees, place, built);
        return { failure: ran.failure, staged: built, left: read.left, said: message, unread: read.unread } satisfies Ran;
      }
      const staging = verifying ? yield* Effect.result(trees.staged(git, place)) : null;
      if (staging?._tag === 'Failure') {
        const read = yield* leftOf(git, trees, place, built);
        return { failure: staging.failure, staged: built, left: read.left, said: message, unread: read.unread } satisfies Ran;
      }
      const staged = staging === null ? built : staging.success;
      const written = yield* Effect.result(said(hosted, place, places.hooks, present, message, kind));
      const read = yield* leftOf(git, trees, place, built);
      if (written._tag === 'Failure')
        return { failure: written.failure, staged, left: read.left, said: message, unread: read.unread } satisfies Ran;
      if (read.unread !== null) {
        return {
          failure: new OwnGitFailed({ op: 'commit-tree-left', message: read.unread, ran: true }),
          staged,
          left: built,
          said: message,
          unread: read.unread,
        } satisfies Ran;
      }
      return { failure: null, staged, left: read.left, said: written.success, unread: null } satisfies Ran;
    }),
  );

const leftStanding = (
  git: Git['Service'],
  trees: CommitTrees['Service'],
  root: string,
  gitDir: string,
  built: string,
): Effect.Effect<Left> =>
  Effect.map(Effect.result(trees.standing(root, gitDir, (place) => leftOf(git, trees, place, built))), (read) =>
    read._tag === 'Success'
      ? read.success
      : { left: built, unread: `the ${read.failure.resource} lane could not be entered again (${read.failure._tag})` },
  );

const cutHooks = (
  git: Git['Service'],
  trees: CommitTrees['Service'],
  root: string,
  gitDir: string,
  built: string,
  started: Ref.Ref<boolean>,
  cut: HoldCut,
): Effect.Effect<never, HoldCut | HookRefused> =>
  Effect.flatMap(Ref.get(started), (begun): Effect.Effect<never, HoldCut | HookRefused> =>
    begun
      ? Effect.flatMap(leftStanding(git, trees, root, gitDir, built), (read) =>
          Effect.fail(new HookRefused({ failure: cut, built, left: read.left, unread: read.unread, earlier: null, stepped: [] })),
        )
      : Effect.fail(cut),
  );

export const commitHooks = Effect.fn('submitWork.hooks')(function* (
  git: Git['Service'],
  hosted: Git['Service'],
  trees: CommitTrees['Service'],
  root: string,
  places: GitPlaces,
  base: string | null,
  built: string,
  message: string,
  kind: HookKind = COMMITTING,
): Effect.fn.Return<Committing, OwnGitFailed | HookRefused | HoldStalled | HoldCut> {
  const present = yield* Effect.promise(() => presentAt(places.hooks));
  const config = yield* commitConfig(git, root);
  const acting = present.has(kind.verify) || present.has('prepare-commit-msg') || present.has('commit-msg');
  const started = yield* Ref.make(false);
  const ran: Ran = acting
    ? yield* hooked(git, hosted, trees, root, places, present, built, message, kind, started).pipe(
        Effect.catchTag('HoldCut', (cut) => cutHooks(git, trees, root, places.gitDir, built, started, cut)),
      )
    : { failure: null, staged: built, left: built, said: message, unread: null };
  const refused = (failure: OwnGitFailed) =>
    new HookRefused({ failure, built, left: ran.left, unread: ran.unread, earlier: null, stepped: [] });
  if (ran.failure !== null) return yield* refused(ran.failure);
  const tree = ran.staged;
  if (tree !== built) {
    const before = yield* (
      base === null
        ? runGit(git, 'submit-empty-tree', ['-C', root, 'hash-object', '-t', 'tree', '--stdin'], { stdin: '' })
        : runGit(git, 'submit-base-tree', ['-C', root, 'rev-parse', `${base}^{tree}`])
    ).pipe(Effect.mapError(refused));
    if (tree === before) {
      return yield* refused(
        new OwnGitFailed({
          op: 'submit-commit',
          message: `nothing to commit: the ${kind.verify} hook left the index as the base stands`,
          ran: true,
        }),
      );
    }
  }
  const final = yield* Effect.mapError(cleaned(git, root, ran.said, config.cleanup), refused);
  if (final.trim() === '') {
    return yield* refused(new OwnGitFailed({ op: 'submit-message', message: 'Aborting commit due to empty commit message.', ran: true }));
  }
  return { tree, left: ran.left, message: final, sign: config.sign, after: present.has(kind.landed) ? new Set([kind.landed]) : new Set() };
});

export type Posted = { readonly tree: string; readonly left: string; readonly unread: string | null };

export const landedHook = (
  git: Git['Service'],
  hosted: Git['Service'],
  trees: CommitTrees['Service'],
  root: string,
  places: GitPlaces,
  commit: string,
  kind: HookKind,
): Effect.Effect<Posted | null> =>
  Effect.flatMap(
    Effect.promise(() => presentAt(places.hooks)),
    (found) => (found.has(kind.landed) ? postCommit(git, hosted, trees, root, places, commit, kind) : Effect.succeed(null)),
  );

const laneSaid = (failure: HoldCut | HoldStalled): string =>
  `the ${failure.resource} lane ${failure._tag === 'HoldCut' ? 'cut it at its ceiling' : 'stayed held past its wait'}`;

const postCommit = Effect.fnUntraced(function* (
  git: Git['Service'],
  hosted: Git['Service'],
  trees: CommitTrees['Service'],
  root: string,
  places: GitPlaces,
  commit: string,
  kind: HookKind,
): Effect.fn.Return<Posted> {
  const tree = yield* Effect.result(runGit(git, 'submit-posted-tree', ['-C', root, 'rev-parse', `${commit}^{tree}`]));
  if (tree._tag === 'Failure') return { tree: commit, left: commit, unread: tree.failure.message };
  const ran = yield* Effect.result(
    trees.within(git, root, places.gitDir, commit, WHOLE_TREE, (place) =>
      Effect.gen(function* () {
        const hooked = yield* Effect.result(run(hosted, place, places.hooks, kind.landed, kind.args));
        if (hooked._tag === 'Failure')
          yield* Effect.logWarning(`the ${kind.landed} hook failed after the commit landed`, { root, reason: hooked.failure.message });
        return yield* leftOf(git, trees, place, tree.success);
      }),
    ),
  );
  if (ran._tag === 'Failure') {
    const reason = ran.failure._tag === 'OwnGitFailed' ? ran.failure.message : laneSaid(ran.failure);
    yield* Effect.logWarning(`the ${kind.landed} hook failed after the commit landed`, { root, reason });
    return { tree: tree.success, left: tree.success, unread: reason };
  }
  return { tree: tree.success, left: ran.success.left, unread: ran.success.unread };
});
