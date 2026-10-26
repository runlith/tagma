import { stat } from 'node:fs/promises';
import { Effect } from 'effect';
import type { Git } from './Git.js';
import { run, commandFor, headAt, literal, type GitAnswerInvalid, type GitRefused, GitUnreadable, pathArgs, pathAt } from './repository.js';
import { ENTRY_WORDS } from './vocabulary.js';
import type { EntryStatus, SequencerKind } from './vocabulary.js';

export type StatusArea = 'staged' | 'unstaged' | 'untracked' | 'unmerged';

export type UnmergedKind =
  | 'both-modified'
  | 'both-added'
  | 'both-deleted'
  | 'added-by-us'
  | 'added-by-them'
  | 'deleted-by-us'
  | 'deleted-by-them';

export type EntryModes = {
  readonly head: string;
  readonly index: string;
  readonly worktree: string;
};

export type Conflict = {
  readonly kind: UnmergedKind;
  readonly stage1: string;
  readonly stage2: string;
  readonly stage3: string;
  readonly worktree: string;
};

export type Submodule = {
  readonly commitChanged: boolean;
  readonly trackedChanges: boolean;
  readonly untrackedChanges: boolean;
};

export type StatusRow = {
  readonly path: string;
  readonly status: EntryStatus;
  readonly oldPath?: string;
  readonly modes?: EntryModes;
  readonly conflict?: Conflict;
  readonly submodule?: Submodule;
};

export type StatusRows = {
  readonly staged: readonly StatusRow[];
  readonly unstaged: readonly StatusRow[];
  readonly untracked: readonly StatusRow[];
  readonly unmerged: readonly StatusRow[];
};

export type Branch = {
  readonly head: string | null;
  readonly ref: string | null;
  readonly upstream: string | null;
  readonly ahead: number | null;
  readonly behind: number | null;
};

export type StatusCoverage = {
  readonly untracked: 'all' | 'no';
  readonly paths: readonly string[] | null;
};

export type StatusOptions = {
  readonly untracked: 'all' | 'no';
  readonly paths?: readonly string[];
  readonly capture?: number;
  readonly monitor?: boolean;
};

export type Status = {
  readonly entries: StatusRows;
  readonly branch: Branch;
  readonly coverage: StatusCoverage;
};

const SCOPED_PATHSPEC = 16_384;

export const pathspecFits = (paths: Iterable<string>): boolean => {
  let weight = 0;
  for (const path of paths) {
    weight += literal(path).length + 1;
    if (weight > SCOPED_PATHSPEC) return false;
  }
  return true;
};

const touches = (path: string, scopes: ReadonlySet<string>): boolean => {
  if (scopes.has(path)) return true;
  for (let at = path.indexOf('/'); at !== -1; at = path.indexOf('/', at + 1)) {
    if (scopes.has(path.slice(0, at))) return true;
  }
  return false;
};

export const mergeScoped = <T extends { readonly path: string; readonly oldPath?: string }>(
  prior: readonly T[],
  fresh: readonly T[],
  scopes: ReadonlySet<string>,
): readonly T[] => {
  const kept = prior.filter((row) => !touches(row.path, scopes) && (row.oldPath === undefined || !touches(row.oldPath, scopes)));
  const merged: T[] = [];
  let old = 0;
  let next = 0;
  while (old < kept.length || next < fresh.length) {
    if (next === fresh.length || (old < kept.length && kept[old]!.path.localeCompare(fresh[next]!.path) <= 0)) {
      merged.push(kept[old++]!);
    } else {
      merged.push(fresh[next++]!);
    }
  }
  return merged;
};

const CONFLICTS: Readonly<Record<string, UnmergedKind>> = {
  DD: 'both-deleted',
  AU: 'added-by-us',
  UD: 'deleted-by-them',
  UA: 'added-by-them',
  DU: 'deleted-by-us',
  AA: 'both-added',
  UU: 'both-modified',
};

const NO_SUBMODULE = 'N...';
const SUBMODULE = /^S([C.])([M.])([U.])$/;
const AHEAD_BEHIND = /^\+(\d+) -(\d+)$/;

const BRANCH_OID = '# branch.oid ';
const BRANCH_HEAD = '# branch.head ';
const BRANCH_UPSTREAM = '# branch.upstream ';
const BRANCH_AB = '# branch.ab ';
const INITIAL = '(initial)';
const DETACHED = '(detached)';

export const OPERATION_PATHS = [
  'rebase-merge',
  'rebase-apply',
  'rebase-apply/applying',
  'MERGE_HEAD',
  'CHERRY_PICK_HEAD',
  'REVERT_HEAD',
] as const;

type FramedRecord = { readonly fields: readonly string[]; readonly path: string };

function framed(record: string, fields: number): FramedRecord | null {
  const taken: string[] = [];
  let at = 0;
  while (taken.length < fields) {
    const space = record.indexOf(' ', at);
    if (space === -1) return null;
    const field = record.slice(at, space);
    if (field === '') return null;
    taken.push(field);
    at = space + 1;
  }
  const path = record.slice(at);
  return path === '' ? null : { fields: taken, path };
}

function submoduleIn(field: string): Submodule | null {
  const flags = SUBMODULE.exec(field);
  if (flags === null) return null;
  return {
    commitChanged: flags[1] === 'C',
    trackedChanges: flags[2] === 'M',
    untrackedChanges: flags[3] === 'U',
  };
}

type Tracked = {
  readonly staged: StatusRow | null;
  readonly unstaged: StatusRow | null;
};

function trackedIn(record: string, renamed: boolean, origin: string | undefined): Tracked | null {
  const read = framed(record, renamed ? 9 : 8);
  if (read === null) return null;
  const [, xy = '', sub = '', head = '', index = '', worktree = ''] = read.fields;
  if (xy.length !== 2) return null;
  if (renamed && (origin === undefined || origin === '')) return null;
  if (!renamed && origin !== undefined) return null;
  const submodule = sub === NO_SUBMODULE ? null : submoduleIn(sub);
  if (submodule === null && sub !== NO_SUBMODULE) return null;
  const staged = xy[0] === '.' ? null : ENTRY_WORDS[xy[0] as string];
  const unstaged = xy[1] === '.' ? null : ENTRY_WORDS[xy[1] as string];
  if (staged === undefined || unstaged === undefined) return null;
  const stood = {
    path: read.path,
    oldPath: origin,
    modes: { head, index, worktree },
    submodule: submodule ?? undefined,
  };
  return {
    staged: staged === null ? null : { ...stood, status: staged },
    unstaged: unstaged === null ? null : { ...stood, status: unstaged },
  };
}

function unmergedIn(record: string): StatusRow | null {
  const read = framed(record, 10);
  if (read === null) return null;
  const [, xy = '', sub = '', stage1 = '', stage2 = '', stage3 = '', worktree = ''] = read.fields;
  const kind = CONFLICTS[xy];
  if (kind === undefined) return null;
  const submodule = sub === NO_SUBMODULE ? null : submoduleIn(sub);
  if (submodule === null && sub !== NO_SUBMODULE) return null;
  return {
    path: read.path,
    status: 'unmerged',
    conflict: { kind, stage1, stage2, stage3, worktree },
    submodule: submodule ?? undefined,
  };
}

function holding(path: string): Effect.Effect<boolean | null> {
  return Effect.promise(async () => {
    try {
      await stat(path);
      return true;
    } catch (failure) {
      const code = (failure as { readonly code?: string }).code;
      return code === 'ENOENT' || code === 'ENOTDIR' ? false : null;
    }
  });
}

export const sequencerAt = Effect.fn('Git.sequencer')(function* (
  git: Git['Service'],
  dir: string,
  capture?: number,
): Effect.fn.Return<SequencerKind, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const gitDir = yield* pathAt(git, dir, ['--git-dir'], capture);
  const stands: boolean[] = [];
  for (const name of OPERATION_PATHS) {
    const path = `${gitDir}/${name}`;
    const there = yield* holding(path);
    if (there === null) {
      return yield* new GitUnreadable({ command: commandFor(dir, pathArgs(['--git-dir'])), reason: `${path} could not be read` });
    }
    stands.push(there);
  }
  const [rebaseMerge, rebaseApply, applying, merge, cherryPick, revert] = stands;
  if (rebaseMerge === true) return 'rebase';
  if (rebaseApply === true) return applying === true ? 'am' : 'rebase';
  if (merge === true) return 'merge';
  if (cherryPick === true) return 'cherry-pick';
  return revert === true ? 'revert' : 'none';
});

export const refreshBranch = Effect.fn('Git.branch')(function* (
  git: Git['Service'],
  dir: string,
  previous: Branch,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<Branch | null, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const head = yield* headAt(git, dir, options);
  if (head.ref === null) {
    if (head.commit === null) {
      return yield* new GitUnreadable({
        command: commandFor(dir, ['rev-parse', 'HEAD']),
        reason: 'HEAD names neither a branch nor a commit',
      });
    }
    return { head: head.commit, ref: null, upstream: null, ahead: null, behind: null };
  }
  const ref = head.ref.slice('refs/heads/'.length);
  if (head.commit === null) return previous.head === null && previous.ref === ref ? previous : null;
  const args = ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(upstream:short)%00%(upstream:track,nobracket)', '--', head.ref];
  const listing = yield* run(git, dir, args, options.capture);
  const unreadable = (reason: string) => new GitUnreadable({ command: commandFor(dir, args), reason });
  const record = listing.split('\n').find((line) => line.startsWith(`${head.ref}\0`));
  if (record === undefined) return yield* unreadable('the branch moved while its metadata was read');
  const fields = record.split('\0');
  const [, commit = '', upstream = '', tracking = ''] = fields;
  if (fields.length !== 4 || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commit))
    return yield* unreadable('the branch metadata was not framed');
  if (upstream === '') return { head: commit, ref, upstream: null, ahead: null, behind: null };
  if (tracking === 'gone') return { head: commit, ref, upstream, ahead: null, behind: null };
  const distance = /^(?:ahead (\d+)(?:, behind (\d+))?|behind (\d+))?$/.exec(tracking);
  if (distance === null) return yield* unreadable('the branch metadata framed no ahead and behind');
  return { head: commit, ref, upstream, ahead: Number(distance[1] ?? 0), behind: Number(distance[2] ?? distance[3] ?? 0) };
});

export const statusAt = Effect.fn('Git.status')(function* (
  git: Git['Service'],
  dir: string,
  options: StatusOptions,
): Effect.fn.Return<Status, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const paths = options.paths ?? null;
  const args = [
    ...(options.monitor === false ? ['-c', 'core.fsmonitor=false'] : []),
    '--no-optional-locks',
    'status',
    '--porcelain=v2',
    '-z',
    '--branch',
    `--untracked-files=${options.untracked}`,
    ...(paths === null ? [] : ['--', ...paths]),
  ];
  const listing = yield* run(git, dir, args, options.capture);
  const unreadable = (reason: string) => new GitUnreadable({ command: commandFor(dir, args), reason });

  const staged: StatusRow[] = [];
  const unstaged: StatusRow[] = [];
  const untracked: StatusRow[] = [];
  const unmerged: StatusRow[] = [];
  let head: string | null = null;
  let ref: string | null = null;
  let upstream: string | null = null;
  let ahead: number | null = null;
  let behind: number | null = null;

  const records = listing.split('\0');
  for (let at = 0; at < records.length; at += 1) {
    const record = records[at] as string;
    if (record === '') continue;
    const kind = record[0];
    if (kind === '#') {
      if (record.startsWith(BRANCH_OID)) {
        const oid = record.slice(BRANCH_OID.length);
        head = oid === INITIAL ? null : oid;
      } else if (record.startsWith(BRANCH_HEAD)) {
        const named = record.slice(BRANCH_HEAD.length);
        ref = named === DETACHED ? null : named;
      } else if (record.startsWith(BRANCH_UPSTREAM)) {
        upstream = record.slice(BRANCH_UPSTREAM.length);
      } else if (record.startsWith(BRANCH_AB)) {
        const distance = AHEAD_BEHIND.exec(record.slice(BRANCH_AB.length));
        if (distance === null) return yield* unreadable('status framed no ahead and behind');
        ahead = Number(distance[1]);
        behind = Number(distance[2]);
      }
      continue;
    }
    if (kind === '1' || kind === '2') {
      const renamed = kind === '2';
      const origin = renamed ? records[at + 1] : undefined;
      if (renamed) at += 1;
      const tracked = trackedIn(record, renamed, origin);
      if (tracked === null) return yield* unreadable(`status printed a ${kind} record this reader cannot frame`);
      if (tracked.staged !== null) staged.push(tracked.staged);
      if (tracked.unstaged !== null) unstaged.push(tracked.unstaged);
      continue;
    }
    if (kind === 'u') {
      const conflicted = unmergedIn(record);
      if (conflicted === null) return yield* unreadable('status printed a u record this reader cannot frame');
      unmerged.push(conflicted);
      continue;
    }
    if (kind === '?') {
      const read = framed(record, 1);
      if (read === null) return yield* unreadable('status printed an untracked record with no path');
      untracked.push({ path: read.path, status: 'untracked' });
      continue;
    }
    return yield* unreadable(`status printed a ${kind as string} record this reader does not know`);
  }

  return {
    entries: { staged, unstaged, untracked, unmerged },
    branch: { head, ref, upstream, ahead, behind },
    coverage: { untracked: options.untracked, paths },
  };
});
