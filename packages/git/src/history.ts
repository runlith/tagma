import { Effect } from 'effect';
import type { Git } from './Git.js';
import {
  run,
  runEnded,
  commandFor,
  commitArgs,
  commitOf,
  literal,
  type GitAnswerInvalid,
  type GitRefused,
  GitUnreadable,
} from './repository.js';
import { ENTRY_WORDS } from './vocabulary.js';
import type { EntryStatus } from './vocabulary.js';

export type LineStat = { readonly added: number; readonly removed: number } | 'binary';

export type PathStat = {
  readonly path: string;
  readonly oldPath?: string;
  readonly lines: LineStat;
};

export type NumstatOptions = {
  readonly cached?: boolean;
  readonly paths?: readonly string[];
  readonly capture?: number;
};

export type ComparedRow = {
  readonly path: string;
  readonly status: EntryStatus;
  readonly oldPath?: string;
  readonly lines: LineStat;
};

export type Comparison =
  | { readonly outcome: 'no-merge-base' }
  | {
      readonly outcome: 'compared';
      readonly mergeBase: string;
      readonly head: string;
      readonly entries: readonly ComparedRow[];
      readonly added: number;
      readonly removed: number;
    };

export type Commit = {
  readonly sha: string;
  readonly parents: readonly string[];
  readonly author: string;
  readonly email: string;
  readonly date: string;
  readonly subject: string;
};

export type CommitFiles = {
  readonly entries: readonly ComparedRow[];
  readonly added: number;
  readonly removed: number;
};

export type LogOptions = {
  readonly range: string;
  readonly max: number;
  readonly skip?: number;
  readonly paths?: readonly string[];
  readonly grep?: string;
  readonly excludeConfined?: (path: string) => boolean;
  readonly capture?: number;
};

const PAIRED = /^[RC]\d+$/;
const COUNT = /^\d+$/;

const FIELD = String.fromCharCode(0x1f);
const FORMAT = '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s';
const TOUCHING = ['--name-only', '--no-renames', `--format=%x00${FORMAT.slice('--format='.length)}`];
const HEADS = 5;
const OWN_WINDOW = 64;
const OBJECT_ID = /^[0-9a-f]{7,64}$/;

function commitIn(record: string): Commit | null {
  const fields: string[] = [];
  let at = 0;
  while (fields.length < HEADS) {
    const mark = record.indexOf(FIELD, at);
    if (mark === -1) break;
    fields.push(record.slice(at, mark));
    at = mark + 1;
  }
  const [sha = '', parents = '', author = '', email = '', date = ''] = fields;
  if (fields.length < HEADS || sha === '') return null;
  return { sha, parents: parents === '' ? [] : parents.split(' '), author, email, date, subject: record.slice(at) };
}

function commitsIn(listing: string): Commit[] | null {
  const commits: Commit[] = [];
  for (const record of listing.split('\0')) {
    if (record === '') continue;
    const commit = commitIn(record);
    if (commit === null) return null;
    commits.push(commit);
  }
  return commits;
}

type Touching = { readonly commit: Commit; readonly paths: string[] };

function touchingIn(listing: string): Touching[] | null {
  const touching: Touching[] = [];
  let current: Touching | null = null;
  let header = false;
  let separator = false;
  for (const field of listing.split('\0')) {
    if (field === '') {
      header = true;
      continue;
    }
    if (header) {
      const commit = commitIn(field);
      if (commit === null) return null;
      current = { commit, paths: [] };
      touching.push(current);
      header = false;
      separator = true;
      continue;
    }
    if (current === null) return null;
    current.paths.push(separator && field.startsWith('\n') ? field.slice(1) : field);
    separator = false;
  }
  return touching;
}

const holdsWork = (touching: Touching, confined: (path: string) => boolean): boolean => touching.paths.some((path) => !confined(path));

type Weighing = { readonly named: readonly NamedChange[]; readonly stats: readonly PathStat[]; readonly numbersArgs: readonly string[] };

const weighedApart = Effect.fn('Git.weighedApart')(function* (
  git: Git['Service'],
  dir: string,
  walk: readonly string[],
  range: readonly string[],
  capture: number | undefined,
): Effect.fn.Return<Weighing, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const namesArgs = [...walk, '--name-status', ...range];
  const named = namesIn(yield* run(git, dir, namesArgs, capture));
  if (named === null) {
    return yield* new GitUnreadable({
      command: commandFor(dir, namesArgs),
      reason: 'name-status printed a record this reader cannot frame',
    });
  }
  const numbersArgs = [...walk, '--numstat', ...range];
  const stats = numstatIn(yield* run(git, dir, numbersArgs, capture));
  if (stats === null) {
    return yield* new GitUnreadable({ command: commandFor(dir, numbersArgs), reason: 'numstat printed a record this reader cannot frame' });
  }
  return { named, stats, numbersArgs };
});

const weighedChanges = Effect.fn('Git.weighedChanges')(function* (
  git: Git['Service'],
  dir: string,
  walk: readonly string[],
  range: readonly string[],
  capture: number | undefined,
): Effect.fn.Return<CommitFiles, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const together = [...walk, '--raw', '--numstat', ...range];
  const listed = yield* run(git, dir, together, capture).pipe(Effect.catchTag('GitAnswerInvalid', () => Effect.succeed(null)));
  let weighing: Weighing;
  if (listed === null) weighing = yield* weighedApart(git, dir, walk, range, capture);
  else {
    const fields = listed.split('\0');
    const raw = rawIn(fields);
    if (raw === null) {
      return yield* new GitUnreadable({
        command: commandFor(dir, together),
        reason: 'the raw diff printed a record this reader cannot frame',
      });
    }
    const stats = numstatOf(fields, raw.next);
    if (stats === null) {
      return yield* new GitUnreadable({ command: commandFor(dir, together), reason: 'numstat printed a record this reader cannot frame' });
    }
    weighing = { named: raw.named, stats, numbersArgs: together };
  }
  const { named, stats, numbersArgs } = weighing;
  const weighed = new Map(stats.map((stat) => [stat.path, stat.lines]));
  const entries: ComparedRow[] = [];
  let added = 0;
  let removed = 0;
  for (const change of named) {
    const lines = weighed.get(change.path);
    if (lines === undefined) {
      return yield* new GitUnreadable({ command: commandFor(dir, numbersArgs), reason: `numstat weighed no ${change.path}` });
    }
    if (lines !== 'binary') {
      added += lines.added;
      removed += lines.removed;
    }
    entries.push({ ...change, lines });
  }
  return { entries, added, removed };
});

function numstatIn(listing: string): PathStat[] | null {
  return numstatOf(listing.split('\0'), 0);
}

function numstatOf(fields: readonly string[], from: number): PathStat[] | null {
  const stats: PathStat[] = [];
  for (let at = from; at < fields.length; at += 1) {
    const record = fields[at] as string;
    if (record === '') continue;
    const first = record.indexOf('\t');
    const second = record.indexOf('\t', first + 1);
    if (first === -1 || second === -1) return null;
    const added = record.slice(0, first);
    const removed = record.slice(first + 1, second);
    const binary = added === '-' && removed === '-';
    if (!binary && !(COUNT.test(added) && COUNT.test(removed))) return null;
    const lines: LineStat = binary ? 'binary' : { added: Number(added), removed: Number(removed) };
    const path = record.slice(second + 1);
    if (path !== '') {
      stats.push({ path, lines });
      continue;
    }
    const oldPath = fields[at + 1];
    const newPath = fields[at + 2];
    at += 2;
    if (oldPath === undefined || oldPath === '' || newPath === undefined || newPath === '') return null;
    stats.push({ path: newPath, oldPath, lines });
  }
  return stats;
}

type NamedChange = { readonly path: string; readonly status: EntryStatus; readonly oldPath?: string };

function rawIn(fields: readonly string[]): { readonly named: NamedChange[]; readonly next: number } | null {
  const named: NamedChange[] = [];
  let at = 0;
  for (; at < fields.length; at += 1) {
    const header = fields[at] as string;
    if (!header.startsWith(':')) break;
    const letter = header.slice(header.lastIndexOf(' ') + 1);
    const status = ENTRY_WORDS[letter[0] as string];
    const paired = PAIRED.test(letter);
    if (status === undefined || (letter.length > 1 && !paired)) return null;
    const path = fields[at + 1];
    if (path === undefined || path === '') return null;
    at += 1;
    if (!paired) {
      named.push({ path, status });
      continue;
    }
    const landed = fields[at + 1];
    if (landed === undefined || landed === '') return null;
    at += 1;
    named.push({ path: landed, status, oldPath: path });
  }
  return { named, next: at };
}

function namesIn(listing: string): NamedChange[] | null {
  const fields = listing.split('\0');
  const named: NamedChange[] = [];
  for (let at = 0; at < fields.length; at += 1) {
    const letter = fields[at] as string;
    if (letter === '') continue;
    const status = ENTRY_WORDS[letter[0] as string];
    const paired = PAIRED.test(letter);
    if (status === undefined || (letter.length > 1 && !paired)) return null;
    const path = fields[at + 1];
    at += 1;
    if (path === undefined || path === '') return null;
    if (!paired) {
      named.push({ path, status });
      continue;
    }
    const landed = fields[at + 1];
    at += 1;
    if (landed === undefined || landed === '') return null;
    named.push({ path: landed, status, oldPath: path });
  }
  return named;
}

export const numstatAt = Effect.fn('Git.numstat')(function* (
  git: Git['Service'],
  dir: string,
  options: NumstatOptions = {},
): Effect.fn.Return<readonly PathStat[], GitUnreadable | GitRefused | GitAnswerInvalid> {
  const args = [
    ...(options.cached === true ? ['diff', '--cached'] : ['diff-files']),
    '--numstat',
    '-z',
    '-M',
    ...(options.paths === undefined ? [] : ['--', ...options.paths.map(literal)]),
  ];
  const stats = numstatIn(yield* run(git, dir, args, options.capture));
  if (stats === null) {
    return yield* new GitUnreadable({ command: commandFor(dir, args), reason: 'numstat printed a record this reader cannot frame' });
  }
  return stats;
});

export const compareAt = Effect.fn('Git.compare')(function* (
  git: Git['Service'],
  dir: string,
  base: string,
  head: string,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<Comparison, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const capture = options.capture;
  const baseArgs = ['merge-base', '--end-of-options', base, head];
  const found = yield* run(git, dir, baseArgs, capture).pipe(
    Effect.catchTag('GitRefused', (failure) => (failure.status === 1 ? Effect.succeed('') : Effect.fail(failure))),
  );
  const mergeBase = found.trim();
  if (mergeBase === '') return { outcome: 'no-merge-base' };
  const pinned = yield* commitOf(git, dir, head, { capture });
  if (pinned === null) {
    return yield* new GitUnreadable({
      command: commandFor(dir, commitArgs(head)),
      reason: `${head} named no commit beside its merge base`,
    });
  }

  const between = ['-z', '-M', '--end-of-options', mergeBase, pinned];
  const weighed = yield* weighedChanges(git, dir, ['diff'], between, capture);
  return { outcome: 'compared', mergeBase, head: pinned, ...weighed };
});

export const commitFilesAt = Effect.fn('Git.commitFiles')(function* (
  git: Git['Service'],
  dir: string,
  commit: Pick<Commit, 'sha' | 'parents'>,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<CommitFiles, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const parent = commit.parents[0];
  const trees = parent === undefined ? ['--root', '--end-of-options', commit.sha] : ['--end-of-options', parent, commit.sha];
  const walk = ['diff-tree', '-r', '-z', '-M', '--no-commit-id'];
  return yield* weighedChanges(git, dir, walk, trees, options.capture);
});

export const renamedFromAt = Effect.fn('Git.renamedFrom')(function* (
  git: Git['Service'],
  dir: string,
  parent: string,
  commit: string,
  path: string,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<string | null, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const args = ['diff-tree', '-r', '-z', '-M', '--no-commit-id', '--name-status', '--diff-filter=R', '--end-of-options', parent, commit];
  const named = namesIn(yield* run(git, dir, args, options.capture));
  if (named === null) {
    return yield* new GitUnreadable({ command: commandFor(dir, args), reason: 'name-status printed a record this reader cannot frame' });
  }
  return named.find((change) => change.path === path)?.oldPath ?? null;
});

export type ResolvedCommits = { readonly commits: ReadonlyMap<string, Commit>; readonly ambiguous: ReadonlySet<string> };

export const commitsAt = Effect.fn('Git.commits')(function* (
  git: Git['Service'],
  dir: string,
  ids: readonly string[],
  options: { readonly capture?: number } = {},
): Effect.fn.Return<ReadonlyMap<string, Commit>, GitUnreadable | GitRefused | GitAnswerInvalid> {
  return (yield* resolvedCommits(git, dir, ids, options)).commits;
});

export const commitIdsAt = Effect.fn('Git.commitIds')(function* (
  git: Git['Service'],
  dir: string,
  ids: readonly string[],
  options: { readonly capture?: number } = {},
): Effect.fn.Return<ResolvedCommits, GitUnreadable | GitRefused | GitAnswerInvalid> {
  return yield* resolvedCommits(git, dir, ids, options);
});

const resolvedCommits = Effect.fnUntraced(function* (
  git: Git['Service'],
  dir: string,
  ids: readonly string[],
  options: { readonly capture?: number },
): Effect.fn.Return<ResolvedCommits, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const asked = [...new Set(ids.filter((id) => OBJECT_ID.test(id)))];
  const ambiguous = new Set<string>();
  if (asked.length === 0) return { commits: new Map(), ambiguous };
  const checkArgs = ['cat-file', '--batch-check=%(objectname) %(objecttype)'];
  const listed = yield* run(git, dir, checkArgs, options.capture, `${asked.join('\n')}\n`);
  const lines = listed.split('\n').filter((line) => line !== '');
  if (lines.length !== asked.length) {
    return yield* new GitUnreadable({
      command: commandFor(dir, checkArgs),
      reason: 'cat-file answered another number of lines than it was asked',
    });
  }
  const held = new Map<string, string>();
  for (const [at, line] of lines.entries()) {
    const [object = '', kind = ''] = line.split(' ');
    if (kind === 'commit') held.set(asked[at] as string, object);
    else if (kind === 'ambiguous') ambiguous.add(asked[at] as string);
  }
  if (held.size === 0) return { commits: new Map(), ambiguous };
  const args = ['log', '--no-walk=unsorted', '-z', FORMAT, '--end-of-options', ...new Set(held.values())];
  const commits = commitsIn(yield* run(git, dir, args, options.capture));
  if (commits === null) {
    return yield* new GitUnreadable({ command: commandFor(dir, args), reason: 'log printed a record this reader cannot frame' });
  }
  const bySha = new Map(commits.map((commit) => [commit.sha, commit]));
  const answered = new Map<string, Commit>();
  for (const [id, sha] of held) {
    const commit = bySha.get(sha);
    if (commit !== undefined) answered.set(id, commit);
  }
  return { commits: answered, ambiguous };
});

export const ancestorAt = Effect.fn('Git.ancestor')(function* (
  git: Git['Service'],
  dir: string,
  commit: string,
  of: string,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<boolean, GitUnreadable | GitRefused | GitAnswerInvalid> {
  return yield* run(git, dir, ['merge-base', '--is-ancestor', '--end-of-options', commit, of], options.capture).pipe(
    Effect.as(true),
    Effect.catchTag('GitRefused', (failure) => (failure.status === 1 ? Effect.succeed(false) : Effect.fail(failure))),
  );
});

export const ancestryOrderAt = Effect.fn('Git.ancestryOrder')(function* (
  git: Git['Service'],
  dir: string,
  ids: readonly string[],
  options: { readonly max: number; readonly capture: number },
): Effect.fn.Return<ReadonlyMap<string, number>, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const targets = [...new Set(ids)];
  if (targets.length < 2) return new Map(targets.map((id) => [id, 0]));
  const weights = new Map<string, number>();
  for (const id of ids) weights.set(id, (weights.get(id) ?? 0) + 1);
  if (targets.some((id) => !OBJECT_ID.test(id))) {
    return yield* new GitUnreadable({
      command: commandFor(dir, ['rev-list', '--stdin']),
      reason: 'a requested commit is not an object id',
    });
  }
  let base = targets[0] as string;
  for (let at = 1; at < targets.length; at += 128) {
    const args = ['merge-base', '--octopus', '--end-of-options', base, ...targets.slice(at, at + 128)];
    const common = yield* runEnded(git, dir, args, 4096, [1]);
    if (common.status !== 0) {
      base = '';
      break;
    }
    base = common.stdout.trim();
  }
  const args = ['rev-list', '--topo-order', '--reverse', '--parents', `--max-count=${options.max}`, '--stdin'];
  const listed = yield* run(git, dir, args, options.capture, `${[...targets, ...(base === '' ? [] : [`^${base}`])].join('\n')}\n`);
  const entries = listed
    .trim()
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.split(' '));
  const commands = new Set(entries.map(([sha]) => sha));
  const children = new Map<string, number>();
  for (const [, ...parents] of entries)
    for (const parent of parents) if (commands.has(parent) || parent === base) children.set(parent, (children.get(parent) ?? 0) + 1);
  const asked = new Set(targets);
  const live = new Map<string, Set<string>>();
  const ranks = new Map<string, number>();
  if (asked.has(base)) {
    ranks.set(base, 0);
    live.set(base, new Set([base]));
  }
  for (const [sha, ...parents] of entries) {
    if (sha === undefined || !OBJECT_ID.test(sha) || parents.some((parent) => !OBJECT_ID.test(parent))) {
      return yield* new GitUnreadable({ command: commandFor(dir, args), reason: 'rev-list printed a commit row this reader cannot frame' });
    }
    const past = new Set<string>();
    for (const parent of parents) for (const target of live.get(parent) ?? []) past.add(target);
    if (asked.has(sha)) {
      ranks.set(
        sha,
        [...past].reduce((count, target) => count + (weights.get(target) ?? 0), 0),
      );
      past.add(sha);
    }
    live.set(sha, past);
    for (const parent of parents) {
      const left = (children.get(parent) ?? 0) - 1;
      if (left === 0) live.delete(parent);
      else if (left > 0) children.set(parent, left);
    }
    if ((children.get(sha) ?? 0) === 0) live.delete(sha);
  }
  if (ranks.size !== asked.size) {
    return yield* new GitUnreadable({
      command: commandFor(dir, args),
      reason: `the bounded history did not contain ${targets.filter((id) => !ranks.has(id)).join(', ')}`,
    });
  }
  return ranks;
});

export type Divergence = { readonly ahead: number; readonly behind: number };

export const divergenceAt = Effect.fn('Git.divergence')(function* (
  git: Git['Service'],
  dir: string,
  base: string,
  head: string,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<Divergence, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const args = ['rev-list', '--left-right', '--count', '--end-of-options', `${base}...${head}`];
  const counted = (yield* run(git, dir, args, options.capture)).trim().split('\t');
  const behind = Number(counted[0]);
  const ahead = Number(counted[1]);
  if (counted.length !== 2 || !Number.isSafeInteger(behind) || !Number.isSafeInteger(ahead)) {
    return yield* new GitUnreadable({ command: commandFor(dir, args), reason: 'rev-list printed no pair of counts' });
  }
  return { ahead, behind };
});

export const unpushedAt = Effect.fn('Git.unpushed')(function* (
  git: Git['Service'],
  dir: string,
  tip: string,
  besides: readonly string[],
  options: { readonly capture?: number; readonly excludeConfined?: (path: string) => boolean } = {},
): Effect.fn.Return<number, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const range = ['--not', '--remotes', '--not', '--end-of-options', tip, ...besides.map((one) => `^${one}`)];
  const confined = options.excludeConfined;
  if (confined !== undefined) {
    const args = ['log', '-z', ...TOUCHING, ...range];
    const touching = touchingIn(yield* run(git, dir, args, options.capture));
    if (touching === null) {
      return yield* new GitUnreadable({ command: commandFor(dir, args), reason: 'log printed a record this reader cannot frame' });
    }
    return touching.filter((one) => holdsWork(one, confined)).length;
  }
  const args = ['rev-list', '--count', ...range];
  const counted = Number((yield* run(git, dir, args, options.capture)).trim());
  if (!Number.isSafeInteger(counted)) {
    return yield* new GitUnreadable({ command: commandFor(dir, args), reason: 'rev-list printed no count' });
  }
  return counted;
});

export const logAt = Effect.fn('Git.log')(function* (
  git: Git['Service'],
  dir: string,
  options: LogOptions,
): Effect.fn.Return<readonly Commit[], GitUnreadable | GitRefused | GitAnswerInvalid> {
  const argsOf = (max: number, skip: number | undefined, touching: boolean) => [
    'log',
    '-z',
    `--max-count=${max}`,
    ...(skip === undefined ? [] : [`--skip=${skip}`]),
    ...(options.grep === undefined ? [] : [`--grep=${options.grep}`, '--regexp-ignore-case', '--fixed-strings']),
    ...(touching ? TOUCHING : [FORMAT]),
    '--end-of-options',
    options.range,
    ...(options.paths === undefined ? [] : ['--', ...options.paths]),
  ];
  const unframed = (args: readonly string[]) =>
    new GitUnreadable({ command: commandFor(dir, args), reason: 'log printed a record this reader cannot frame' });
  const confined = options.excludeConfined;
  if (confined === undefined) {
    const args = argsOf(options.max, options.skip, false);
    const commits = commitsIn(yield* run(git, dir, args, options.capture));
    return commits === null ? yield* unframed(args) : commits;
  }
  const wanted = (options.skip ?? 0) + options.max;
  for (let window = Math.max(OWN_WINDOW, wanted * 4); ; window *= 4) {
    const args = argsOf(window, undefined, true);
    const touching = touchingIn(yield* run(git, dir, args, options.capture));
    if (touching === null) return yield* unframed(args);
    const own = touching.filter((one) => holdsWork(one, confined)).map((one) => one.commit);
    if (own.length >= wanted || touching.length < window) return own.slice(options.skip ?? 0, wanted);
  }
});
