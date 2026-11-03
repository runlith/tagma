import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Effect, FileSystem } from 'effect';
import type { Git } from '@runlith/git/Git';
import type { TextAt } from '@runlith/git/entries';
import { stagedTextsAt, workingFilesAt } from '@runlith/git/working';
import { bytesDigest, contentDigest } from '@runlith/files/content';
import type { MachineStore, StoreFailure } from '../../platform/contract/service/store.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import { runGit, type OwnGitFailed, configuredGit } from '../../platform/git/ownGit.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { ActorRef } from '../../platform/contract/wire/actor.js';
import type {
  ChangeInput,
  LandingOrigin,
  PreparedFns,
  PreparedReads,
  PreparedRow,
  PreparedEntries,
  PreparedHashes,
  PreparedMerge,
  TeamMember,
} from '../contract/service/prepared.js';
import { rawSides, stagedSides } from './sides.js';
import { listingUnder, standing } from '@runlith/files/working';
import type { Closure } from './closure.js';
import type { Selection } from './team.js';

type StoreShape = Context.Service.Shape<typeof MachineStore>;

type UnitsShape = Context.Service.Shape<typeof MachineUnits>;

export const WEIGHED_BYTES = 4_000_000;

export const nul = (paths: readonly string[]): string => paths.map((path) => `${path}\0`).join('');

export const named = (listing: string): readonly string[] => listing.split('\0').filter((path) => path !== '');

const EMPTY = contentDigest('');

export type Planned<Row extends PreparedRow> = {
  readonly path: string;
  readonly rows: readonly Row[];
  readonly writers: readonly string[];
  readonly ids: readonly string[];
};

export type Built<Row extends PreparedRow> = {
  readonly base: string | null;
  readonly plan: readonly Planned<Row>[];
  readonly changed: readonly string[];
  readonly tree: string;
  readonly hashes: ReadonlyMap<string, PreparedHashes>;
  readonly entries: PreparedEntries;
  readonly unattributed: readonly string[];
};

export type Landing<Row extends PreparedRow> = {
  readonly projectId: number;
  readonly git: Git['Service'];
  readonly root: string;
  readonly store: StoreShape;
  readonly units: UnitsShape;
  readonly reads: PreparedReads<Row>;
  readonly fns: PreparedFns;
  readonly origin: LandingOrigin;
  readonly act: ActorRef;
  readonly checkout: string;
  readonly input: ChangeInput;
  readonly team: readonly TeamMember[];
  readonly selection: Selection;
  readonly index: string;
  readonly gitDir: string;
  readonly commonDir: string;
  readonly job: string;
};

const lstatAt = (path: string) =>
  Effect.tryPromise({ try: () => lstat(path), catch: (cause) => cause }).pipe(
    Effect.catchIf(
      (cause) => typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT',
      () => Effect.succeed(undefined),
    ),
  );

const workingDigest = Effect.fn('prepared.workingDigest')(function* (root: string, path: string) {
  const files = yield* FileSystem.FileSystem;
  const at = join(root, path);
  return yield* Effect.gen(function* (): Effect.fn.Return<string | null | undefined, unknown> {
    const stat = yield* lstatAt(at);
    if (stat === undefined) return EMPTY;
    if (!stat.isFile() || stat.size > WEIGHED_BYTES) return undefined;
    return bytesDigest(yield* files.readFile(at));
  }).pipe(Effect.match({ onFailure: () => undefined, onSuccess: (digest) => digest }));
});

const explained = (rows: readonly PreparedRow[], head: string, working: string): boolean => {
  const left = [...rows];
  for (let at = working; ;) {
    if (at === head) return true;
    const index = left.findLastIndex((row) => (row.afterHash ?? EMPTY) === at);
    if (index < 0) return false;
    at = left[index]?.beforeHash ?? EMPTY;
    left.splice(index, 1);
  }
};

const unattributedAmong = Effect.fnUntraced(function* <Row extends PreparedRow>(
  landing: Landing<Row>,
  base: string | null,
  plan: readonly Planned<Row>[],
  present: (path: string) => boolean,
) {
  const heads = new Map<string, string>();
  if (base !== null) {
    const read = yield* Effect.result(
      workingFilesAt(
        configuredGit(landing.git, 'submit-base'),
        landing.root,
        base,
        plan.map((one) => one.path),
        { capture: WEIGHED_BYTES },
      ),
    );
    if (read._tag === 'Success')
      for (const [at, one] of plan.entries()) {
        const file = read.success[at];
        if (file?._tag === 'Success') heads.set(one.path, file.success === null ? EMPTY : bytesDigest(file.success));
      }
  }
  const found: string[] = [];
  for (const one of plan) {
    const head = base === null ? EMPTY : heads.get(one.path);
    const working = present(one.path) ? yield* workingDigest(landing.root, one.path) : EMPTY;
    if (head === undefined || working === undefined || working === null) continue;
    if (!explained(one.rows, head, working)) found.push(one.path);
  }
  return found;
}, Effect.provide(BunFileSystem.layer));

export const build = Effect.fn('prepared.build')(function* <Row extends PreparedRow>(
  landing: Landing<Row>,
  closure: Closure<Row>,
  base: string | null,
  merge: PreparedMerge | undefined,
): Effect.fn.Return<Built<Row>, OwnGitFailed | StoreFailure | GateRefusal<'path-unread'>> {
  const { git, root, index } = landing;
  const env = { GIT_INDEX_FILE: index };
  const onDisk = listingUnder(root);
  const stood = new Map(
    yield* Effect.forEach(closure.paths, (path) => Effect.map(standing(path, onDisk), (answer) => [path, answer] as const), {
      concurrency: STANDING_AT_ONCE,
    }),
  );
  for (const [path, answer] of stood)
    if (answer !== 'stands' && answer !== 'absent')
      return yield* new GateRefusal('path-unread', `whether ${path} stands on disk cannot be read: ${answer.unread}`, [
        'make its directory readable, then submit again',
        `land without ${path} (paths)`,
      ]);
  const present = (path: string): boolean => stood.get(path) === 'stands';
  const plan = closure.paths.map((path): Planned<Row> => {
    const rows = closure.rows.get(path) ?? [];
    return { path, rows, writers: closure.writers.get(path) ?? [], ids: rows.filter((row) => !row.unresolved).map((row) => row.id) };
  });
  const from = merge?.tree ?? base;
  yield* runGit(git, 'submit-read-tree', ['-C', root, 'read-tree', ...(from === null ? ['--empty'] : [from])], { env });
  const gone = plan.filter((one) => !present(one.path));
  const staying = plan.filter((one) => present(one.path));
  if (gone.length > 0)
    yield* runGit(git, 'submit-unstage', ['-C', root, 'update-index', '--force-remove', '-z', '--stdin'], {
      env,
      stdin: nul(gone.map((one) => one.path)),
    });
  if (staying.length > 0)
    yield* runGit(git, 'submit-stage', ['-C', root, 'update-index', '--add', '--remove', '-z', '--stdin'], {
      env,
      stdin: nul(staying.map((one) => one.path)),
      cleans: true,
    });
  const tree = yield* runGit(git, 'submit-tree', ['-C', root, 'write-tree'], { env });
  const entries =
    base === null
      ? stagedSides(tree, yield* runGit(git, 'submit-changed', ['-C', root, 'ls-files', '--stage', '-z'], { env }))
      : rawSides(
          base,
          tree,
          yield* runGit(git, 'submit-changed', ['-C', root, 'diff-index', '--cached', '--raw', '--no-abbrev', '-z', base, '--'], { env }),
        );
  const hashes = new Map(
    plan.map((one) => {
      const carried = new Set<string>();
      for (const row of one.rows) {
        if (row.beforeHash !== null) carried.add(row.beforeHash);
        if (row.afterHash !== null) carried.add(row.afterHash);
      }
      return [one.path, { carried, peers: NO_PEERS }] as const;
    }),
  );
  const unattributed = yield* unattributedAmong(landing, base, plan, present);
  return { base, plan, changed: [...entries.after.keys()], tree, hashes, entries, unattributed };
});

const NO_PEERS: ReadonlySet<string> = new Set();

export const stagedOf = (index: string): string => `${index}.staged`;

export const stagedTexts = (git: Git['Service'], root: string, paths: readonly string[], index: string): Effect.Effect<readonly TextAt[]> =>
  stagedTextsAt(configuredGit(git, 'submit-staged-texts'), root, paths, stagedOf(index), { capture: WEIGHED_BYTES });

const STANDING_AT_ONCE = 4;
