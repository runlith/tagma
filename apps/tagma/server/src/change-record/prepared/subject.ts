import { randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, openSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Context, Data, Effect, FileSystem } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import type { Git } from '@runlith/git/Git';
import { dataPathOf, type MachineStore } from '../../platform/contract/service/store.js';
import { mergeTreeAt } from '@runlith/git/merge';
import { actingGit, identityOf, notAdmitted, quietGit, readingFailed, runGit, OwnGitFailed } from '../../platform/git/ownGit.js';
import { AGENT_PERSON } from '../../platform/contract/wire/commits.js';
import { mergeParents } from '../../platform/git/publish.js';
import { type GitPlaces, type OpenOperation, operationIn, standingOf } from '../../platform/git/places.js';
import { indexWrites } from '../../platform/git/index.js';
import { closeOnExec, lockExclusive } from '@runlith/file-lock/flock';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import {
  LinesUnread,
  type PreparedHolds,
  type PreparedLine,
  type PreparedLineHolders,
  type PreparedMerge,
  type PreparedRow,
  type PreparedSubject,
} from '../contract/service/prepared.js';
import { type Landing, named, stagedOf } from './tree.js';
import type { Finished } from './shaped.js';
import { type StepHunk, sourceLines, stepHunks } from './stepLines.js';
import { holdsOf } from './holds.js';
import type { HolderLines } from '../threadFiles/authored.js';
import { carriesOf } from '../threadFiles/carries.js';
import { holderKey } from '../../workspace/contract/wire/checkout.js';

type StoreShape = Context.Service.Shape<typeof MachineStore>;

const SAID_HEAD = 160;

const SAID_TAIL = 1200;

const within = (lines: readonly string[], budget: number): number => {
  let size = 0;
  let taken = 0;
  for (const line of lines) {
    size += taken === 0 ? line.length : line.length + 2;
    if (size > budget) break;
    taken += 1;
  }
  return taken;
};

const capped = (lines: readonly string[]): string => {
  const whole = lines.join('; ');
  if (whole.length <= SAID_HEAD + SAID_TAIL) return whole;
  const last = lines.at(-1) ?? '';
  if (last.length > SAID_TAIL) return `…; ${last.slice(-SAID_TAIL)}`;
  const tail = within([...lines].reverse(), SAID_TAIL);
  const head = within(lines.slice(0, lines.length - tail), SAID_HEAD);
  const cut = lines.length - tail - head;
  if (cut === 0) return whole;
  return [...lines.slice(0, head), `… ${cut} line${cut === 1 ? '' : 's'} cut …`, ...lines.slice(lines.length - tail)].join('; ');
};

export const saidByGit = (failure: OwnGitFailed): string => {
  const said = capped(
    failure.message
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('hint:') && !line.startsWith('(use ')),
  );
  return failure.reason === 'locked' ? `another commit was running here; run it again — git said: ${said}` : `git said: ${said}`;
};

const NO_BRANCH = (): GateRefusal<'no-branch'> =>
  new GateRefusal('no-branch', 'this checkout stands on no branch, and a commit lands on one', [
    'check out the branch this work belongs on, then submit again',
  ]);

export const onBranch = (
  git: Git['Service'],
  root: string,
): Effect.Effect<Branched, GateRefusal<'no-branch' | 'git-unavailable' | 'git-not-admitted'>> =>
  Effect.flatMap(
    Effect.mapError(standingOf(git, root), (error) => {
      if (error.admission !== undefined) return notAdmitted(error.admission);
      return error.ran
        ? NO_BRANCH()
        : new GateRefusal('git-unavailable', `git could not run, so nothing about the branch was read: ${error.message}`, [
            'read the execution host (read_commands): a host that cannot start a process is replaced by the operator, and a shell that answers again is the sign to submit again',
          ]);
    }),
    ({ places, head }) => (head.ref === null ? Effect.fail(NO_BRANCH()) : Effect.succeed({ places, ref: head.ref, commit: head.commit })),
  );

export type Branched = { readonly places: GitPlaces; readonly ref: string; readonly commit: string | null };

export const INDEX_PREFIX = 'tagma-prepared-';

const INSTANCE_PREFIX = 'instance-';

const CLAIM_PREFIX = 'claim-';

const LOCK_NAME = 'lock';

export type PreparedEntry = 'instance' | 'claim' | 'foreign';

export const kindOfPreparedEntry = (name: string): PreparedEntry => {
  if (name.startsWith(INSTANCE_PREFIX)) return 'instance';
  if (name.startsWith(CLAIM_PREFIX)) return 'claim';
  return 'foreign';
};

export const preparedBase = (store: StoreShape): string =>
  join(dataPathOf(store.path) ?? tmpdir(), dataPathOf(store.path) === null ? 'tagma-change-record' : 'change-record', 'prepared');

export class PreparedInstanceFailed extends Data.TaggedError('PreparedInstanceFailed')<{
  readonly reason: string;
}> {}

export type PreparedInstance = {
  readonly dir: string;
  readonly release: Effect.Effect<void>;
};

const abandonClaim = (fd: number | null, staging: string): void => {
  if (fd !== null) {
    try {
      closeSync(fd);
    } catch {
      return;
    }
  }
  try {
    rmSync(staging, { recursive: true, force: true });
  } catch {
    return;
  }
};

export const claimPreparedInstance = (base: string): Effect.Effect<PreparedInstance, PreparedInstanceFailed> =>
  Effect.try({
    try: (): PreparedInstance => {
      mkdirSync(base, { recursive: true, mode: 0o700 });
      for (let attempt = 0; ; attempt += 1) {
        if (attempt >= 8) throw new Error(`no instance directory stayed claimed under ${base}`);
        const id = randomUUID();
        const staging = join(base, `${CLAIM_PREFIX}${id}`);
        try {
          mkdirSync(staging);
        } catch (error) {
          if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') continue;
          throw error;
        }
        const dir = join(base, `${INSTANCE_PREFIX}${id}`);
        let fd: number | null = null;
        try {
          fd = openSync(join(staging, LOCK_NAME), 'w');
          closeOnExec(fd);
          if (lockExclusive(fd) !== 'locked') throw new Error(`the instance lock is already held: ${staging}`);
          renameSync(staging, dir);
        } catch (error) {
          abandonClaim(fd, staging);
          if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') continue;
          if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') continue;
          throw error;
        }
        if (fd === null) continue;
        const held: number = fd;
        const release = Effect.uninterruptible(
          Effect.gen(function* () {
            yield* Effect.sync(() => closeSync(held));
            const files = yield* FileSystem.FileSystem;
            yield* Effect.orDie(files.remove(dir, { recursive: true, force: true }));
          }),
        ).pipe(Effect.provide(BunFileSystem.layer));
        return { dir, release };
      }
    },
    catch: (cause) => new PreparedInstanceFailed({ reason: `a prepared instance directory could not be claimed: ${String(cause)}` }),
  });

export type InstanceLock = 'locked' | 'held' | 'missing';

export const sweepInstance = (lock: InstanceLock, empty: boolean): boolean => lock === 'locked' || (lock === 'missing' && empty);

export const sweepClaim = (lock: InstanceLock): boolean => lock === 'locked';

export const locateIndex = (dir: string): Effect.Effect<string> => Effect.sync(() => join(dir, `${INDEX_PREFIX}${randomUUID()}.index`));

export const releaseIndex = Effect.fn('prepared.releaseIndex')(
  function* (index: string) {
    const files = yield* FileSystem.FileSystem;
    yield* files.remove(index, { force: true });
    yield* files.remove(`${index}.lock`, { force: true });
    yield* files.remove(stagedOf(index), { recursive: true, force: true });
  },
  Effect.orDie,
  Effect.uninterruptible,
  Effect.provide(BunFileSystem.layer),
);

export const holdersOf = <Row extends PreparedRow>(
  landing: Landing<Row>,
  built: Finished<Row>,
): { readonly holders: PreparedLineHolders; readonly holds: PreparedHolds } => {
  const planned = new Map(built.plan.map((one) => [one.path, one] as const));
  const team = new Set(landing.team.map((one) => one.threadId));
  const carries = new Map<string, readonly HolderLines[]>();
  const stepped = new Map<string, readonly StepHunk[]>();
  const reshaped = new Set(built.reshaped.map((one) => one.path));
  const loaded = Effect.fnUntraced(function* (lines: readonly PreparedLine[]) {
    const due = [...new Set(lines.map((one) => one.file))].filter((file) => planned.has(file) && !carries.has(file));
    if (due.length === 0) return;
    const through = due.filter((path) => reshaped.has(path));
    for (const cut of landing.fns.pathChunks(through)) {
      const read = yield* Effect.mapError(
        stepHunks(landing.git, landing.root, built.from, built.tree, cut),
        (failure) =>
          new LinesUnread({ reason: `what the commit steps changed in ${cut.join(', ')} could not be read: ${saidByGit(failure)}` }),
      );
      for (const [path, hunks] of read) stepped.set(path, hunks);
    }
    const judged = yield* landing.fns.judged(landing, due);
    for (const path of due) carries.set(path, carriesOf(judged.get(path)?.verdict, new Map()));
  });
  return {
    holders: (lines) =>
      Effect.map(loaded(lines), () =>
        lines.map(({ file, line }) => {
          const hunks = stepped.get(file);
          const sources = hunks === undefined ? [line] : sourceLines(hunks, line);
          return (carries.get(file) ?? [])
            .filter((carry) => !team.has(holderKey(carry.holder.holder)))
            .filter((carry) => sources.length > 0 && sources.every((source) => carry.added.has(source)))
            .map((carry) => holderKey(carry.holder.holder));
        }),
      ),
    holds: holdsOf(landing, planned),
  };
};

export const emptyTree = (git: Git['Service'], root: string): Effect.Effect<string, OwnGitFailed> =>
  runGit(git, 'submit-empty-tree', ['-C', root, 'hash-object', '-t', 'tree', '-w', '--stdin'], { stdin: '' });

export const subjectOf = <Row extends PreparedRow, Caller>(
  landing: Landing<Row>,
  built: Finished<Row>,
  caller: Caller,
  merge: PreparedMerge | undefined,
): Effect.Effect<PreparedSubject<Caller>, OwnGitFailed> =>
  Effect.map(built.base === null ? emptyTree(landing.git, landing.root) : Effect.succeed(built.base), (base) => ({
    kind: 'tree',
    projectId: landing.projectId,
    root: landing.root,
    commonDir: landing.commonDir,
    base,
    built: built.tree,
    merged: merge?.parents,
    paths: built.changed,
    job: landing.job,
    ...holdersOf(landing, built),
    caller,
  }));

export const headOf = (git: Git['Service'], root: string): Effect.Effect<string | null, OwnGitFailed> =>
  Effect.catch(runGit(git, 'submit-head', ['-C', root, 'rev-parse', '--verify', '-q', 'HEAD']), (failure) =>
    failure.ran && failure.message === '' ? Effect.succeed(null) : Effect.fail(failure),
  );

export const readMerge = Effect.fn('prepared.merge')(function* (
  git: Git['Service'],
  root: string,
  places: GitPlaces,
): Effect.fn.Return<PreparedMerge | undefined, GateRefusal<'tree-mid-merge' | 'landing-busy'> | OwnGitFailed> {
  const open = yield* operationIn(places);
  if (open === null) return undefined;
  if (open !== 'merge')
    return yield* new GateRefusal('tree-mid-merge', `a ${open} is in progress in ${root}`, [
      `conclude or abort the ${open} as \`git status\` says, then submit again`,
    ]);
  const conflicts = named(yield* runGit(git, 'submit-conflicts', ['-C', root, 'diff', '--name-only', '--diff-filter=U', '-z']));
  if (conflicts.length > 0)
    return yield* new GateRefusal('tree-mid-merge', `the merge in ${root} still has unresolved conflicts: ${conflicts.join(', ')}`, [
      'resolve and stage those files, then submit_work concludes the merge; graph files are staged by resolve_graph_conflict',
    ]);
  const parents = yield* mergeParents(git, root);
  const staged = yield* runGit(git, 'submit-merge-tree', ['-C', root, 'write-tree']);
  const head = yield* runGit(git, 'submit-merge-head', ['-C', root, 'rev-parse', 'HEAD']);
  const start = yield* mergeStart(git, root, head);
  if (start === head) return { parents, tree: staged };
  const own = yield* runGit(git, 'submit-merge-own', ['-C', root, 'commit-tree', staged, '-p', start, '-m', 'merge index'], {
    env: identityOf(AGENT_PERSON),
  });
  const laid = yield* Effect.mapError(mergeTreeAt(actingGit(git, 'submit-merge-over'), root, head, own, { mergeBase: start }), (failure) =>
    readingFailed('submit-merge-over', failure),
  );
  if (laid.conflicts.length > 0)
    return yield* new GateRefusal(
      'tree-mid-merge',
      `HEAD of ${root} moved while its merge stood open, and both changed ${laid.conflicts.join(', ')}`,
      ['bring those files in the index to what the merge and HEAD both need, stage them, then submit again'],
    );
  return { parents, tree: laid.tree };
});

const mergeStart = (git: Git['Service'], root: string, head: string): Effect.Effect<string, OwnGitFailed> =>
  Effect.map(quietGit(git, 'submit-merge-start', ['-C', root, 'rev-parse', '--verify', '-q', 'ORIG_HEAD^{commit}']), (sha) => sha || head);

export const besideMerge = Effect.fn('prepared.besideMerge')(function* (
  git: Git['Service'],
  root: string,
  carried: readonly string[],
  open: OpenOperation | null,
): Effect.fn.Return<boolean, OwnGitFailed> {
  if (open !== 'merge') return false;
  const start = yield* mergeStart(git, root, yield* runGit(git, 'submit-merge-head', ['-C', root, 'rev-parse', 'HEAD']));
  const paths = new Set(
    named(yield* runGit(git, 'submit-merge-paths', ['-C', root, 'diff-index', '--cached', '--name-only', '--no-renames', '-z', start])),
  );
  return !carried.some((path) => paths.has(path));
});

export const mergeFor = (git: Git['Service'], root: string, places: GitPlaces, open: OpenOperation | null): ReturnType<typeof readMerge> =>
  (open === null ? Effect.succeed(undefined) : indexWrites.hold(places.index, readMerge(git, root, places))).pipe(
    Effect.catchTags({
      HoldStalled: () =>
        Effect.fail(new GateRefusal('landing-busy', `the index of ${root} stayed busy, so its merge was not read`, ['submit again'])),
      HoldCut: () =>
        Effect.fail(
          new GateRefusal('landing-busy', `reading the merge index of ${root} was cut`, ['read the checkout, then submit again']),
        ),
    }),
  );
