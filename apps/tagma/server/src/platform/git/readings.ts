import { lstat, readlink, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect } from 'effect';
import type { Git } from '@runlith/git/Git';
import { type GitAnswerInvalid, type GitRefused, type GitUnreadable, headAt, runEnded, troubleOf } from '@runlith/git/repository';
import { type Status, statusAt } from '@runlith/git/status';
import { GateRefusal, type GitRefusal } from '../contract/wire/refusal.js';
import { notAdmitted } from './ownGit.js';

export const gitRefusal = (failure: GitUnreadable | GitRefused | GitAnswerInvalid): GateRefusal<GitRefusal> => {
  if (failure._tag === 'GitUnreadable' && failure.admission !== undefined) return notAdmitted(failure.admission);
  return new GateRefusal<GitRefusal>(
    failure._tag === 'GitRefused' ? 'git-refused' : failure._tag === 'GitAnswerInvalid' ? 'git-incomplete' : 'git-unreadable',
    troubleOf(failure),
    ['read what git said above and run that command yourself to see why'],
  );
};

export const gitText = Effect.fn('Git.text')(function* (
  git: Git['Service'],
  cwd: string,
  args: readonly string[],
): Effect.fn.Return<string | null, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const ended = yield* runEnded(git, cwd, args, undefined, [1]);
  return ended.status === 0 ? ended.stdout : null;
});

export const gitLines = Effect.fn('Git.lines')(function* (
  git: Git['Service'],
  cwd: string,
  args: readonly string[],
): Effect.fn.Return<string[] | null, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const output = yield* gitText(git, cwd, args);
  return output === null ? null : output.split('\n').filter((line) => line.length > 0);
});

export const gitPaths = Effect.fn('Git.paths')(function* (
  git: Git['Service'],
  cwd: string,
  args: readonly string[],
): Effect.fn.Return<string[] | null, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const output = yield* gitText(git, cwd, args);
  return output === null ? null : output.split('\0').filter((path) => path.length > 0);
});

export type TreeReading = { readonly changed: number; readonly fingerprint: string | null };

type Trouble = GitUnreadable | GitRefused | GitAnswerInvalid;

type SourceModule = { readonly pinned: string | null; readonly head: string | null; readonly inventory: SourceInventory };

export type SourceInventory = {
  readonly entries: ReadonlyMap<string, string | null>;
  readonly modules: ReadonlyMap<string, SourceModule>;
};

const FINGERPRINT_LENGTH = 12;

const changedIn = (status: Status): number => {
  const { staged, unstaged, unmerged, untracked } = status.entries;
  return new Set([...staged, ...unstaged, ...unmerged].map((entry) => entry.path)).size + untracked.length;
};

const sourcePaths: (git: Git['Service'], cwd: string) => Effect.Effect<readonly string[], Trouble> = Effect.fn('Git.sourcePaths')(
  function* (git, cwd) {
    const listed = yield* gitPaths(git, cwd, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
    const paths: string[] = [];
    for (const path of listed ?? []) {
      if (path.endsWith('/')) paths.push(...(yield* sourcePaths(git, join(cwd, path))).map((nested) => `${path}${nested}`));
      else paths.push(path);
    }
    return [...new Set(paths)];
  },
);

const quotedPath = (path: string): string =>
  `"${path.replace(/[\\"\u0000-\u001f\u007f]/gu, (character) =>
    character === '"' || character === '\\' ? `\\${character}` : `\\${character.charCodeAt(0).toString(8).padStart(3, '0')}`,
  )}"`;

const repositoryHead = Effect.fn('Git.repositoryHead')(function* (
  git: Git['Service'],
  at: string,
): Effect.fn.Return<string | null, Trouble> {
  const own = yield* Effect.promise(() => realpath(at).catch(() => null));
  if (own === null) return null;
  const [top = '', head = ''] = ((yield* gitText(git, own, ['rev-parse', '--show-toplevel', '--verify', '-q', 'HEAD'])) ?? '').split('\n');
  return top === own && head !== '' ? head : null;
});

const committedStates = Effect.fn('Git.committedStates')(function* (
  git: Git['Service'],
  cwd: string,
  commit: string,
  paths: readonly string[],
) {
  const states = new Map<string, string>();
  if (paths.length === 0) return states;
  for (const row of ((yield* gitText(git, cwd, ['ls-tree', '-r', '-z', '--full-tree', commit, '--', ...paths])) ?? '').split('\0')) {
    const listed = /^(\d{6}) \w+ ([0-9a-f]+)\t(.+)$/su.exec(row);
    if (listed?.[1] !== undefined && listed[2] !== undefined && listed[3] !== undefined) states.set(listed[3], `${listed[1]}:${listed[2]}`);
  }
  return states;
});

export const sourceInventory: (
  git: Git['Service'],
  cwd: string,
  commit: string | null,
  inputs?: readonly string[],
) => Effect.Effect<SourceInventory, Trouble> = Effect.fn('Git.sourceInventory')(function* (git, cwd, commit, inputs = []) {
  const entries = new Map<string, string | null>();
  const pinned = new Map<string, string | null>();
  if (commit === null) {
    for (const path of (yield* gitPaths(git, cwd, ['ls-files', '-z'])) ?? []) entries.set(path, null);
  } else {
    const parts = ((yield* gitText(git, cwd, ['diff', commit, '--raw', '-z', '--no-renames', '--no-abbrev'])) ?? '').split('\0');
    for (let at = 0; at + 1 < parts.length; at += 2) {
      const [mode = '', next = '', id = ''] = (parts[at] ?? '').slice(1).split(' ');
      const path = parts[at + 1] ?? '';
      if (mode === '160000' || next === '160000') pinned.set(path, mode === '160000' ? id : null);
      else entries.set(path, mode === '000000' ? null : `${mode}:${id}`);
    }
  }
  for (const path of (yield* gitPaths(git, cwd, ['ls-files', '-z', '--others', '--exclude-standard'])) ?? []) {
    const leaves = path.endsWith('/') ? (yield* sourcePaths(git, join(cwd, path))).map((nested) => `${path}${nested}`) : [path];
    for (const leaf of leaves) if (!entries.has(leaf)) entries.set(leaf, null);
  }
  const within = (path: string): string | undefined => [...pinned.keys()].find((module) => path.startsWith(`${module}/`));
  const declared = inputs.filter((path) => !entries.has(path) && within(path) === undefined);
  const states = commit === null ? new Map<string, string>() : yield* committedStates(git, cwd, commit, declared);
  for (const path of declared) entries.set(path, states.get(path) ?? null);
  const modules = new Map<string, SourceModule>();
  for (const [path, id] of pinned) {
    const at = join(cwd, path);
    const head = yield* repositoryHead(git, at);
    const nested = inputs.filter((input) => within(input) === path).map((input) => input.slice(path.length + 1));
    const inventory = head === null ? { entries: new Map(), modules: new Map() } : yield* sourceInventory(git, at, head, nested);
    modules.set(path, { pinned: id, head, inventory });
  }
  return { entries, modules };
});

const worktreeStates = Effect.fn('Git.worktreeStates')(function* (git: Git['Service'], root: string, names: readonly string[]) {
  const kinds = yield* Effect.forEach(
    names,
    (name) =>
      Effect.promise(() =>
        lstat(join(root, name)).then(
          (info) => (info.isSymbolicLink() ? '120000' : info.isFile() ? ((info.mode & 0o111) === 0 ? '100644' : '100755') : null),
          () => null,
        ),
      ),
    { concurrency: 16 },
  );
  const files = names.filter((_, index) => kinds[index] === '100644' || kinds[index] === '100755');
  const hashed =
    files.length === 0
      ? []
      : (yield* runEnded(git, root, ['hash-object', '--no-filters', '--stdin-paths'], undefined, [], {
          stdin: `${files.map(quotedPath).join('\n')}\n`,
        })).stdout.split('\n');
  const ids = new Map(files.map((name, index) => [name, hashed[index] ?? '']));
  const states: (string | null)[] = [];
  for (const [index, name] of names.entries()) {
    const kind = kinds[index] ?? null;
    if (kind === '120000') {
      const target = yield* Effect.promise(() => readlink(join(root, name)));
      const id = (yield* runEnded(git, root, ['hash-object', '--no-filters', '--stdin'], undefined, [], { stdin: target })).stdout.trim();
      states.push(`${kind}:${id}`);
    } else states.push(kind === null ? null : `${kind}:${ids.get(name) ?? ''}`);
  }
  return states;
});

export const measureSource: (git: Git['Service'], root: string, inventory: SourceInventory) => Effect.Effect<TreeReading, Trouble> =
  Effect.fn('Git.measureSource')(function* (git, root, inventory) {
    const names = [...inventory.entries.keys()].sort();
    const states = yield* worktreeStates(git, root, names);
    const values: string[] = [];
    let changed = 0;
    for (const [index, name] of names.entries()) {
      const state = states[index] ?? null;
      if (state === inventory.entries.get(name)) continue;
      changed += 1;
      values.push(name, state ?? '-');
    }
    for (const [path, module] of [...inventory.modules].sort(([left], [right]) => (left < right ? -1 : 1))) {
      const at = join(root, path);
      const head = yield* repositoryHead(git, at);
      const nested = head === null ? { changed: 0, fingerprint: null } : yield* measureSource(git, at, module.inventory);
      if (head === module.pinned && nested.changed === 0) continue;
      changed += 1;
      values.push(path, head ?? '-', nested.fingerprint ?? '');
    }
    if (changed === 0) return { changed, fingerprint: null };
    const hasher = new Bun.CryptoHasher('sha256');
    for (const value of values) hasher.update(`${value.length}:`).update(value);
    return { changed, fingerprint: hasher.digest('hex').slice(0, FINGERPRINT_LENGTH) };
  });

export const sourceTree = Effect.fn('Git.sourceTree')(function* (
  git: Git['Service'],
  cwd: string,
  status: Status,
  inputs: readonly string[] = [],
  measured = true,
): Effect.fn.Return<TreeReading, Trouble> {
  const listed = changedIn(status);
  if (listed === 0 && inputs.length === 0) return { changed: 0, fingerprint: null };
  const staged = new Set(status.entries.staged.flatMap((row) => (row.oldPath === undefined ? [row.path] : [row.path, row.oldPath])));
  const surely =
    status.entries.unmerged.length > 0 ||
    status.entries.unstaged.some((row) => !staged.has(row.path)) ||
    status.entries.untracked.some((row) => !staged.has(row.path));
  if (!measured && surely) return { changed: listed + inputs.length, fingerprint: null };
  const reading = yield* measureSource(git, cwd, yield* sourceInventory(git, cwd, status.branch.head, inputs));
  return measured ? reading : { changed: reading.changed, fingerprint: null };
});

export const gitTree = Effect.fn('Git.tree')(function* (
  git: Git['Service'],
  cwd: string,
  inputs: readonly string[] = [],
): Effect.fn.Return<TreeReading, Trouble> {
  return yield* sourceTree(git, cwd, yield* statusAt(git, cwd, { untracked: 'all' }), inputs);
});

export const gitCut = Effect.fn('Git.cut')(function* (
  git: Git['Service'],
  cwd: string,
): Effect.fn.Return<{ head: string; dirty: boolean } | null, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const named = yield* gitText(git, cwd, ['rev-parse', '--verify', '--quiet', '--short', 'HEAD']);
  const head = named === null ? '' : named.trim();
  if (head === '') return null;
  const status = yield* statusAt(git, cwd, { untracked: 'no' });
  const { staged, unstaged, unmerged } = status.entries;
  return { head, dirty: staged.length + unstaged.length + unmerged.length > 0 };
});

const NOT_A_REPOSITORY = /^fatal: not a git repository/m;

export const headNamed = Effect.fn('Git.headNamed')(function* (
  git: Git['Service'],
  cwd: string,
): Effect.fn.Return<string | null, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const read = yield* Effect.result(headAt(git, cwd));
  if (read._tag === 'Success') return read.success.ref ?? read.success.commit;
  if (read.failure._tag === 'GitRefused' && NOT_A_REPOSITORY.test(read.failure.message)) return null;
  return yield* read.failure;
});
