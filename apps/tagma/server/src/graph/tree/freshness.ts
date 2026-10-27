import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Effect } from 'effect';
import { excludesFileAt } from '../../platform/git/excludes.js';
import { OwnGitFailed, actingGit, quietGit, runGit } from '../../platform/git/ownGit.js';
import type { EntryStatus } from '@runlith/git/vocabulary';
import type { Git } from '@runlith/git/Git';
import { type StatusRows, mergeScoped, pathspecFits, statusAt } from '@runlith/git/status';
import { literal, troubleOf } from '@runlith/git/repository';

export type TreeChange = { readonly status: string; readonly path: string };

export type IgnoreRules = { readonly files: readonly string[]; readonly stamp: string };

export type TreeSeen = TreeBasis & { readonly prefix: string; readonly base: string | null };

function insideTree(prefix: string, path: string): string | null {
  if (prefix === '') return path;
  return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}

function treeRelative(prefix: string, changes: readonly TreeChange[]): TreeChange[] {
  return changes.flatMap((change) => {
    const path = insideTree(prefix, change.path);
    return path === null ? [] : [{ status: change.status, path }];
  });
}

const LETTERS: Readonly<Record<EntryStatus, string>> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  untracked: 'A',
  unmerged: 'U',
};

function changesIn(entries: StatusRows): TreeChange[] {
  const byPath = new Map<string, string>();
  for (const area of [entries.untracked, entries.unmerged, entries.unstaged, entries.staged]) {
    for (const entry of area) {
      byPath.set(entry.path, LETTERS[entry.status]);
      if (entry.status === 'renamed' && entry.oldPath !== undefined) byPath.set(entry.oldPath, 'D');
    }
  }
  return [...byPath].map(([path, status]) => ({ status, path }));
}

export type TreeBasis = {
  readonly head: string | null;
  readonly dirty: readonly TreeChange[];
  readonly rules: IgnoreRules | null;
};

export type TreeMark = { readonly position: string; readonly slot: 0 | 1 | 2; readonly filed: boolean };

export type StoredBasis = TreeBasis & { readonly mark: TreeMark | null; readonly fallback: TreeMark | null };

export type TreeScope = { readonly since: TreeBasis; readonly paths: ReadonlySet<string>; readonly staged: boolean };

const statusOf = (git: Git['Service'], treeRoot: string, paths: readonly string[]) =>
  statusAt(actingGit(git, 'dirty'), treeRoot, { untracked: 'all', paths }).pipe(
    Effect.mapError((failure) => new OwnGitFailed({ op: 'dirty', message: troubleOf(failure), ran: failure._tag !== 'GitUnreadable' })),
  );

const IGNORE_FILE = '.gitignore';

type TreePlace = { readonly prefix: string; readonly rules: readonly string[] | null; readonly configs: readonly string[] };

const places = new Map<string, TreePlace>();

const ruleFiles = (prefix: string, top: string, configs: readonly string[], common: string): readonly string[] => {
  const segments = prefix.split('/').filter((segment) => segment !== '');
  const above = segments.map((_, at) => join(top, ...segments.slice(0, at), IGNORE_FILE));
  return [...above, join(common, 'info', 'exclude'), ...configs];
};

const placeAt = (prefix: string, top: string, common: string, own: string): TreePlace => {
  const configs = [join(common, 'config'), join(own, 'config.worktree')];
  return { prefix, rules: ruleFiles(prefix, top, configs, common), configs };
};

const placeOf = Effect.fnUntraced(function* (git: Git['Service'], treeRoot: string): Effect.fn.Return<TreePlace, OwnGitFailed> {
  const known = places.get(treeRoot);
  if (known !== undefined) return known;
  const lines = (yield* runGit(git, 'place', [
    '-C',
    treeRoot,
    'rev-parse',
    '--show-prefix',
    '--show-toplevel',
    '--git-common-dir',
    '--git-dir',
  ])).split('\n');
  const [prefix, top, common, own] = lines;
  const place: TreePlace =
    lines.length === 4 && prefix !== undefined && top !== undefined && common !== undefined && own !== undefined
      ? placeAt(prefix, top, resolve(treeRoot, common), resolve(treeRoot, own))
      : { prefix: yield* runGit(git, 'prefix', ['-C', treeRoot, 'rev-parse', '--show-prefix']), rules: null, configs: [] };
  places.set(treeRoot, place);
  return place;
});

const excludesSeen = new Map<string, { readonly stamp: string; readonly file: string | null }>();

const INCLUDES = /^\s*\[\s*include(if)?\b/im;

const includesIn = (configs: readonly string[]): Effect.Effect<boolean> =>
  Effect.promise(async () => {
    for (const config of configs) {
      const text = await readFile(config, 'utf8').catch((failure: { readonly code?: string }) =>
        failure.code === 'ENOENT' || failure.code === 'ENOTDIR' ? '' : null,
      );
      if (text === null || INCLUDES.test(text)) return true;
    }
    return false;
  });

const excludesOf = Effect.fnUntraced(function* (
  git: Git['Service'],
  treeRoot: string,
  place: TreePlace,
  basis: string,
): Effect.fn.Return<string | null, OwnGitFailed> {
  const seen = excludesSeen.get(treeRoot);
  if (seen !== undefined && seen.stamp === basis) return seen.file;
  excludesSeen.delete(treeRoot);
  const file = yield* excludesFileAt(actingGit(git, 'excludes'), treeRoot);
  if (!(yield* includesIn(place.configs))) excludesSeen.set(treeRoot, { stamp: basis, file });
  return file;
});

const stampOf = (files: readonly string[]): Effect.Effect<string | null> =>
  Effect.promise(async () => {
    const parts: string[] = [];
    for (const file of files) {
      try {
        const at = await stat(file, { bigint: true });
        parts.push(`${at.ino}:${at.size}:${at.mtimeNs}:${at.ctimeNs}`);
      } catch (failure) {
        const code = (failure as { readonly code?: string }).code;
        if (code !== 'ENOENT' && code !== 'ENOTDIR') return null;
        parts.push('-');
      }
    }
    return parts.join('\0');
  });

const rulesOf = Effect.fnUntraced(function* (
  git: Git['Service'],
  treeRoot: string,
  place: TreePlace,
): Effect.fn.Return<IgnoreRules | null, OwnGitFailed> {
  if (place.rules === null) return null;
  const basis = yield* stampOf(place.rules);
  if (basis === null) return null;
  const excludes = yield* excludesOf(git, treeRoot, place, basis);
  if (excludes === null) return { files: place.rules, stamp: basis };
  const own = yield* stampOf([excludes]);
  return own === null ? null : { files: [...place.rules, excludes], stamp: `${basis}\0${own}` };
});

const GIT_DIR = '.git';

const widens = (path: string): boolean => path === '' || path === IGNORE_FILE || path.endsWith(`/${IGNORE_FILE}`);

const scopedPaths = (scope: TreeScope | null): ReadonlySet<string> | null => {
  if (scope === null) return null;
  const paths = new Set([...scope.paths].filter((path) => path !== GIT_DIR && !path.startsWith(`${GIT_DIR}/`)));
  if (!pathspecFits(paths)) return null;
  for (const path of paths) if (widens(path)) return null;
  return paths;
};

const listed = (out: string): readonly string[] => out.split('\0').filter((path) => path !== '');

type TreeMovement = { readonly paths: readonly string[] | null; readonly base: string | null };

const movedPaths = Effect.fnUntraced(function* (
  git: Git['Service'],
  treeRoot: string,
  from: string | null,
  to: string | null,
  staged: boolean,
): Effect.fn.Return<TreeMovement, OwnGitFailed> {
  const paths: string[] = [];
  if (staged && to !== null) {
    paths.push(
      ...listed(
        yield* runGit(git, 'staged', ['-C', treeRoot, 'diff-index', '--cached', '--name-only', '-z', '--no-renames', '--relative', to]),
      ),
    );
  }
  if (from === to) return { paths, base: null };
  if (from === null || to === null) return { paths: null, base: null };
  const base = yield* quietGit(git, 'stamped', ['-C', treeRoot, 'rev-parse', '--verify', '-q', `${from}^{commit}`]);
  if (base === null) return { paths: null, base: null };
  paths.push(...listed(yield* runGit(git, 'moved', ['-C', treeRoot, 'diff', '--name-only', '-z', '--no-renames', '--relative', from, to])));
  return { paths, base };
});

export const treeSeen = Effect.fnUntraced(function* (
  git: Git['Service'],
  treeRoot: string,
  scope: TreeScope | null = null,
): Effect.fn.Return<TreeSeen, OwnGitFailed> {
  const place = yield* placeOf(git, treeRoot);
  const { prefix } = place;
  const named = scopedPaths(scope);
  const since = scope?.since.rules ?? null;
  if (named !== null && scope !== null && since !== null && (yield* stampOf(since.files)) === since.stamp) {
    const seen = named.size === 0 ? null : yield* statusOf(git, treeRoot, [...named].map(literal));
    const head = seen === null ? yield* quietGit(git, 'head', ['-C', treeRoot, 'rev-parse', '--verify', '-q', 'HEAD']) : seen.branch.head;
    const moved = yield* movedPaths(git, treeRoot, scope.since.head, head, scope.staged);
    const extra = moved.paths === null ? null : moved.paths.filter((path) => !named.has(path));
    const read = extra === null ? null : new Set([...named, ...extra]);
    if (extra !== null && read !== null && pathspecFits(read) && !extra.some(widens)) {
      const more = extra.length === 0 ? null : yield* statusOf(git, treeRoot, extra.map(literal));
      if (more === null || more.branch.head === head) {
        yield* Effect.annotateCurrentSpan('status', read.size);
        const rows = [...(seen === null ? [] : changesIn(seen.entries)), ...(more === null ? [] : changesIn(more.entries))];
        return { head, prefix, base: moved.base, rules: since, dirty: mergeScoped(scope.since.dirty, treeRelative(prefix, rows), read) };
      }
    }
  }
  yield* Effect.annotateCurrentSpan('status', 'whole');
  const rules = yield* rulesOf(git, treeRoot, place);
  const seen = yield* statusOf(git, treeRoot, ['.']);
  return { head: seen.branch.head, prefix, base: null, rules, dirty: treeRelative(prefix, changesIn(seen.entries)) };
});

function parseDelta(out: string): TreeChange[] | null {
  const fields = out.split('\0');
  if (fields.length > 0 && fields[fields.length - 1] === '') fields.pop();
  if (fields.length % 2 !== 0) return null;
  const changes: TreeChange[] = [];
  for (let at = 0; at < fields.length; at += 2) {
    const letter = fields[at] as string;
    const path = fields[at + 1] as string;
    if (letter === '' || path === '') return null;
    changes.push({ status: letter.slice(0, 1), path });
  }
  return changes;
}

const isTreeFile = (change: TreeChange): boolean => change.path.endsWith('.md');

export type FreshnessStatus = 'fresh' | 'repaired' | 'rebuilt';

export type FreshnessDrivers<E, R> = {
  readonly readStamp: Effect.Effect<string | null, E, R>;
  readonly writeStamp: (sha: string) => Effect.Effect<unknown, E, R>;
  readonly unreflected: (changed: readonly TreeChange[]) => Effect.Effect<TreeChange[], E, R>;
  readonly rebuild: Effect.Effect<unknown, E, R>;
  readonly repair: (changed: readonly TreeChange[]) => Effect.Effect<unknown, E, R>;
};

export type TreeReading = TreeBasis & {
  readonly stamped: string | null;
  readonly changes: readonly TreeChange[] | null;
};

export const readTree = Effect.fnUntraced(function* <E, R>(
  git: Git['Service'],
  treeRoot: string,
  readStamp: Effect.Effect<string | null, E, R>,
  scope: TreeScope | null = null,
): Effect.fn.Return<TreeReading, E | OwnGitFailed, R> {
  const seen = yield* treeSeen(git, treeRoot, scope);
  const stamped = yield* readStamp;
  const reading = (changes: readonly TreeChange[] | null): TreeReading => ({
    head: seen.head,
    stamped,
    changes,
    dirty: seen.dirty,
    rules: seen.rules,
  });
  if (stamped === null) return reading(null);
  const byPath = new Map<string, TreeChange>();
  if (seen.head !== null && stamped !== seen.head) {
    if (
      stamped !== seen.base &&
      (yield* quietGit(git, 'stamped', ['-C', treeRoot, 'rev-parse', '--verify', '-q', `${stamped}^{commit}`])) === null
    )
      return reading(null);
    const delta = yield* runGit(git, 'delta', [
      '-C',
      treeRoot,
      '-c',
      'core.quotePath=false',
      'diff',
      '--name-status',
      '--no-renames',
      '-z',
      stamped,
      seen.head,
    ]);
    const moved = parseDelta(delta);
    if (moved === null) return reading(null);
    for (const change of treeRelative(seen.prefix, moved)) byPath.set(change.path, change);
  }
  for (const change of seen.dirty) byPath.set(change.path, change);
  return reading([...byPath.values()].filter(isTreeFile));
});

export const applyTree = Effect.fnUntraced(function* <E, R>(
  reading: TreeReading,
  drivers: Omit<FreshnessDrivers<E, R>, 'readStamp'>,
): Effect.fn.Return<FreshnessStatus, E, R> {
  const stampAt = reading.head === null ? Effect.void : drivers.writeStamp(reading.head);
  const rebuilt = Effect.gen(function* () {
    yield* drivers.rebuild;
    yield* stampAt;
    return 'rebuilt' as const;
  });
  if (reading.changes === null) return yield* rebuilt;
  const changed = yield* drivers.unreflected(reading.changes);
  if (changed.length === 0) {
    if (reading.stamped !== reading.head) yield* stampAt;
    return 'fresh';
  }
  const repaired = yield* Effect.result(drivers.repair(changed));
  if (repaired._tag !== 'Success') return yield* rebuilt;
  yield* stampAt;
  return 'repaired';
});

export function ensureFreshMirror<E, R>(
  git: Git['Service'],
  treeRoot: string,
  drivers: FreshnessDrivers<E, R>,
): Effect.Effect<FreshnessStatus, E | OwnGitFailed, R> {
  return Effect.flatMap(readTree(git, treeRoot, drivers.readStamp), (reading) => applyTree(reading, drivers));
}
