import { Effect, Schema, type FileSystem } from 'effect';
import { stagedEntriesAt, type TreeEntry } from '@runlith/git/entries';
import { treePathsAt } from '@runlith/git/treePaths';
import { commandFor, commitOf, GitUnreadable, literal } from '@runlith/git/repository';
import { statusAt } from '@runlith/git/status';
import type { Git } from '@runlith/git/Git';
import { join } from 'node:path';
import { actingGit } from '../../platform/git/ownGit.js';
import { PathUnreadable } from '../../workspace/contract/service/checkouts.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import type { AuthorshipSide, PathAuthorship, SubmoduleDiff, SubmoduleEnd } from '../contract/wire/authorship.js';
import { READING_CAPTURE, refusedByGit } from './failures.js';

export const entryAt = Effect.fnUntraced(function* (git: Git['Service'], dir: string, revision: string | null, path: string) {
  if (revision === null) return null;
  const found = (yield* treePathsAt(git, dir, revision, [path], { gitlinks: true, relative: 'cwd' })).get(path)!;
  const entry = yield* Effect.fromResult(found).pipe(
    Effect.catchTag('GitUnreadable', (failure) =>
      revision !== 'HEAD'
        ? Effect.fail(failure)
        : Effect.flatMap(Effect.catchTag(commitOf(git, dir, 'HEAD', { capture: READING_CAPTURE }), 'GitRefused', refusedByGit), (head) =>
            head === null ? Effect.succeed(null) : Effect.fail(failure),
          ),
    ),
  );
  return entry === null ? null : { mode: entry.mode, object: entry.blob };
});

const isLink = (entry: TreeEntry | null): boolean => entry?.mode === '160000';

const endOf = (entry: TreeEntry | null): SubmoduleEnd =>
  entry === null ? { kind: 'absent' } : isLink(entry) ? { kind: 'commit', oid: entry.object } : { kind: 'file' };

export const submoduleAnswer = (rootId: RootId, path: string, submodule: SubmoduleDiff): PathAuthorship => ({
  rootId,
  path,
  submodule,
  lines: [],
  binary: false,
  timedOut: false,
  sides: {
    before: submodule.before.kind === 'absent' ? null : path,
    after: submodule.after.kind === 'absent' ? null : path,
  },
});

export const pastSubmodule = (before: TreeEntry | null, after: TreeEntry | null): SubmoduleDiff | null =>
  isLink(before) || isLink(after) ? { before: endOf(before), after: endOf(after) } : null;

const notLink = Schema.is(Schema.Struct({ code: Schema.Literal('EINVAL') }));

const kindAt = Effect.fnUntraced(function* (files: FileSystem.FileSystem, path: string) {
  return yield* files.readLink(path).pipe(
    Effect.as('SymbolicLink' as const),
    Effect.catchReason('PlatformError', 'Unknown', (reason, error) =>
      notLink(reason.cause) ? Effect.map(files.stat(path), (entry) => entry.type) : Effect.fail(error),
    ),
    Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(null)),
    Effect.mapError((cause) => new PathUnreadable({ path, cause, asking: 'probe' })),
  );
});

export const workingSubmodule = Effect.fn('Authorship.submodule')(function* (
  git: Git['Service'],
  files: FileSystem.FileSystem,
  dir: string,
  path: string,
  head: TreeEntry | null,
  side?: AuthorshipSide,
) {
  const at = join(dir, path);
  const standing = side === 'staged' ? null : yield* kindAt(files, at);
  if (side === undefined && !isLink(head) && standing !== 'Directory' && (head !== null || standing !== null)) return null;
  const own = actingGit(git, 'thread-files-submodule');
  const index = yield* stagedEntriesAt(own, dir, [path], { capture: READING_CAPTURE });
  const unread = index.unread.get(path);
  if (unread !== undefined)
    return yield* new GitUnreadable({ command: commandFor(dir, ['ls-files', '--stage', '--', path]), reason: unread });
  const staged = index.entries.get(path) ?? null;
  if (!isLink(head) && !isLink(staged)) return null;
  const before = side === 'unstaged' ? staged : head;
  if (side === 'staged') return pastSubmodule(before, staged);
  if (!isLink(staged)) {
    return {
      before: endOf(before),
      after: standing === null || standing === 'Directory' ? { kind: 'absent' as const } : { kind: 'file' as const },
    };
  }
  if (standing !== null && standing !== 'Directory') return { before: endOf(before), after: { kind: 'file' as const } };
  const status = yield* Effect.catchTag(
    statusAt(own, dir, { paths: [literal(path)], untracked: 'all', monitor: false, ignoreSubmodules: 'none', capture: READING_CAPTURE }),
    'GitRefused',
    refusedByGit,
  );
  const row = status.entries.unstaged.find((row) => row.path === path) ?? status.entries.staged.find((row) => row.path === path);
  const metadata = standing === null ? null : yield* kindAt(files, join(at, '.git'));
  if (metadata === null) {
    const missing = row?.modes?.worktree === '000000';
    return {
      before: endOf(before),
      after: missing ? { kind: 'absent' as const } : endOf(staged),
      working: { state: missing ? ('missing' as const) : ('uninitialized' as const), trackedChanges: false, untrackedChanges: false },
    };
  }
  const oid = yield* Effect.catchTag(commitOf(own, at, 'HEAD', { capture: READING_CAPTURE }), 'GitRefused', refusedByGit);
  if (oid === null)
    return yield* new GitUnreadable({
      command: commandFor(at, ['rev-parse', 'HEAD']),
      reason: 'the submodule has no readable HEAD commit',
    });
  return {
    before: endOf(before),
    after: { kind: 'commit' as const, oid },
    working: {
      state: 'ready' as const,
      trackedChanges: row?.submodule?.trackedChanges ?? false,
      untrackedChanges: row?.submodule?.untrackedChanges ?? false,
    },
  };
});
