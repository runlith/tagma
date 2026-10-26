import { basename, dirname, resolve } from 'node:path';
import { ToolFailed } from '@runlith/agent/tool';
import { entryAt, fileFailure, type Entry } from '@runlith/files/replace';
import { Effect, FileSystem, Result } from 'effect';
import type { PlatformError } from 'effect/PlatformError';
import { GLOBSTAR } from 'minimatch';
import { aliasRefusal } from '../namespace';
import type { ResolvedToolOptions } from '../workspace';
import { removalArguments } from './arguments';
import type { RemovalInput, RemovalIssue, RemovalSelection, RemovalStage, RemovalTarget } from './model';
import { removalOrder } from './order';
import { removalPatterns, type PathPattern } from './patterns';

type DirectorySnapshot = {
  readonly names: readonly string[];
  readonly exact: ReadonlySet<string>;
};

type LocatedEntry = {
  readonly path: string;
  readonly entry: Entry;
};

type SelectedEntry = {
  readonly path: string;
  readonly entry: Entry;
  readonly operands: Set<string>;
};

type IssueGroup = {
  readonly issue: RemovalIssue;
  readonly operands: Set<string>;
};

type PatternFrame = {
  readonly path: string;
  readonly at: number;
};

const nameOrder = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

export function issueOf(path: string, stage: RemovalStage, error: PlatformError): RemovalIssue {
  const cause: unknown = error.reason.cause;
  const code: unknown = cause !== null && typeof cause === 'object' && 'code' in cause ? cause.code : undefined;
  const codes: Readonly<Record<string, string>> = {
    ENOENT: 'not-found',
    ENOTDIR: 'not-directory',
    EACCES: 'permission-denied',
    EPERM: 'operation-not-permitted',
    EROFS: 'read-only-filesystem',
    EBUSY: 'busy',
    ELOOP: 'symlink-loop',
    ENOTEMPTY: 'directory-not-empty',
  };
  const tags: Readonly<Record<string, string>> = {
    NotFound: 'not-found',
    PermissionDenied: 'permission-denied',
    BadResource: 'bad-resource',
    Busy: 'busy',
  };
  const classified = (typeof code === 'string' ? codes[code] : undefined) ?? tags[error.reason._tag] ?? 'unknown';
  const reason = fileFailure(error);
  return {
    path,
    stage,
    code: classified,
    reason: classified === 'unknown' ? `${reason}; no known filesystem condition classifies this error.` : reason,
  };
}

export const selectRemoval = Effect.fn('removal.select')(function* (
  resolved: ResolvedToolOptions,
  input: RemovalInput,
): Effect.fn.Return<RemovalSelection, ToolFailed, FileSystem.FileSystem> {
  const { options, operands } = yield* removalArguments(input.args);
  const plans = yield* removalPatterns(operands, input.glob ?? true, resolved.world.environment.platform === 'win32');
  const operandOrder = new Map<string, number>();
  for (const [index, operand] of operands.entries()) if (!operandOrder.has(operand)) operandOrder.set(operand, index);
  if (input.workdir?.includes('\0'))
    return yield* new ToolFailed({ code: 'invalid-argument', reason: 'The working directory contains a null byte.' });
  const fs = yield* FileSystem.FileSystem;
  const askedCwd = resolve(resolved.cwd, input.workdir ?? '.');
  const cwd = yield* fs
    .realPath(askedCwd)
    .pipe(
      Effect.mapError(
        (error) =>
          new ToolFailed({ code: 'resolve-failed', reason: `Cannot establish working directory ${askedCwd}: ${fileFailure(error)}` }),
      ),
    );
  const cwdEntry = yield* entryAt(cwd).pipe(
    Effect.mapError((error) => new ToolFailed({ code: 'resolve-failed', reason: fileFailure(error) })),
  );
  if (cwdEntry?.kind !== 'directory')
    return yield* new ToolFailed({ code: 'not-directory', reason: `The working directory is not a directory: ${cwd}.` });

  const entries = new Map<string, Result.Result<Entry | undefined, PlatformError>>([[cwd, Result.succeed(cwdEntry)]]);
  const directories = new Map<string, Result.Result<DirectorySnapshot, PlatformError>>();
  const realDirectories = new Map<string, Result.Result<string, PlatformError>>([
    [askedCwd, Result.succeed(cwd)],
    [cwd, Result.succeed(cwd)],
  ]);
  const issues = new Map<string, IssueGroup>();
  let origins: readonly string[] = [];
  const sortOrigins = (origins: Iterable<string>): string[] =>
    [...origins].sort((left, right) => (operandOrder.get(left) ?? 0) - (operandOrder.get(right) ?? 0));
  const roots = new Map<string, SelectedEntry>();

  const addIssue = (issue: RemovalIssue): void => {
    const key = `${issue.path}\0${issue.stage}\0${issue.code}`;
    let group = issues.get(key);
    if (group === undefined) {
      group = { issue, operands: new Set() };
      issues.set(key, group);
    }
    for (const operand of issue.operands ?? origins) group.operands.add(operand);
  };
  const readEntry = Effect.fnUntraced(function* (path: string) {
    const cached = entries.get(path);
    if (cached !== undefined) return cached;
    const read = yield* Effect.result(entryAt(path));
    entries.set(path, read);
    return read;
  });
  const readDirectory = Effect.fn('removal.directory')(function* (path: string) {
    const cached = directories.get(path);
    if (cached !== undefined) return cached;
    const read = yield* Effect.result(
      fs.readDirectory(path).pipe(Effect.map((names): DirectorySnapshot => ({ names, exact: new Set(names) }))),
    );
    directories.set(path, read);
    return read;
  });
  const realDirectory = Effect.fn('removal.parent')(function* (path: string) {
    const cached = realDirectories.get(path);
    if (cached !== undefined) return cached;
    const read = yield* Effect.result(fs.realPath(path));
    realDirectories.set(path, read);
    if (read._tag === 'Success') realDirectories.set(read.success, read);
    return read;
  });
  const locate = Effect.fnUntraced(function* (
    path: string,
  ): Effect.fn.Return<Result.Result<LocatedEntry | undefined, RemovalIssue>, never, FileSystem.FileSystem> {
    const parent = dirname(path);
    const real = yield* realDirectory(parent);
    if (real._tag === 'Failure') return Result.fail(issueOf(path, 'resolve', real.failure));
    const name = basename(path);
    const pinned = parent === path ? real.success : resolve(real.success, name);
    const read = yield* readEntry(pinned);
    if (read._tag === 'Failure') return Result.fail(issueOf(pinned, 'resolve', read.failure));
    if (read.success === undefined) return Result.succeed(undefined);
    if (parent !== path) {
      const listing = yield* readDirectory(real.success);
      if (listing._tag === 'Failure') return Result.fail(issueOf(real.success, 'resolve', listing.failure));
      if (!listing.success.exact.has(name))
        return Result.fail({ path, stage: 'resolve', code: 'aliased', reason: aliasRefusal(cwd, path, undefined) });
    }
    return Result.succeed({ path: pinned, entry: read.success });
  });

  const expand = Effect.fn('removal.expand')(function* (pattern: PathPattern) {
    const found = new Map<string, Entry>();
    let failed = false;
    const anchor = yield* realDirectory(resolve(cwd, pattern.prefix));
    if (anchor._tag === 'Failure') {
      const issue = issueOf(resolve(cwd, pattern.prefix), 'expand', anchor.failure);
      if (issue.code !== 'not-found') {
        addIssue(issue);
        failed = true;
      }
      return { found, failed };
    }
    const pending: PatternFrame[] = [{ path: anchor.success, at: 0 }];
    const visited = new Set<string>();
    while (pending.length !== 0) {
      const frame = pending.pop();
      if (frame === undefined) break;
      const { path, at } = frame;
      const key = `${path}\0${at}`;
      if (visited.has(key)) continue;
      visited.add(key);
      const read = yield* readEntry(path);
      if (read._tag === 'Failure') {
        addIssue(issueOf(path, 'expand', read.failure));
        failed = true;
        continue;
      }
      const entry = read.success;
      if (entry === undefined) continue;
      if (at === pattern.parts.length) {
        if (!pattern.directoryOnly || entry.kind === 'directory' || entry.kind === 'link') found.set(path, entry);
        continue;
      }
      const part = pattern.parts[at]!;
      if (part === GLOBSTAR) pending.push({ path, at: at + 1 });
      if (entry.kind !== 'directory') continue;
      if (part === '.' || part === '..' || part === '') {
        pending.push({ path: part === '..' ? dirname(path) : path, at: at + 1 });
        continue;
      }
      const listing = yield* readDirectory(path);
      if (listing._tag === 'Failure') {
        addIssue(issueOf(path, 'expand', listing.failure));
        failed = true;
        continue;
      }
      const children: string[] = [];
      for (let index = listing.success.names.length - 1; index >= 0; index--) {
        const name = listing.success.names[index];
        if (name === undefined) continue;
        const matches = part === GLOBSTAR ? !name.startsWith('.') : typeof part === 'string' ? part === name : part.test(name);
        if (!matches) continue;
        const child = resolve(path, name);
        children.push(child);
        pending.push({ path: child, at: part === GLOBSTAR ? at : at + 1 });
      }
      yield* Effect.forEach(children, readEntry, { concurrency: 3 });
    }
    return { found, failed };
  });

  for (const plan of plans) {
    origins = [plan.operand];
    const matches = new Map<string, Entry>();
    let failed = false;
    for (const pattern of plan.patterns) {
      if (pattern.parts.length !== 0) {
        const expansion = yield* expand(pattern);
        failed ||= expansion.failed;
        for (const [path, entry] of expansion.found) matches.set(path, entry);
        continue;
      }
      const located = yield* locate(resolve(cwd, pattern.prefix));
      if (located._tag === 'Failure') {
        if (located.failure.code !== 'not-found') {
          addIssue(located.failure);
          failed = true;
        }
        continue;
      }
      if (located.success === undefined) continue;
      const { path, entry } = located.success;
      if (pattern.directoryOnly && entry.kind !== 'directory' && entry.kind !== 'link') {
        addIssue({
          path,
          stage: 'resolve',
          code: 'not-directory',
          reason: `A trailing separator requires a directory or symlink: ${path}.`,
        });
        failed = true;
        continue;
      }
      matches.set(path, entry);
    }
    if (matches.size === 0 && !failed)
      addIssue({
        path: plan.magic ? plan.operand : resolve(cwd, plan.patterns[0]?.prefix ?? plan.operand),
        stage: plan.magic ? 'expand' : 'resolve',
        code: plan.magic ? 'no-match' : 'not-found',
        reason: plan.magic ? `No entries match ${plan.operand}.` : `No entry exists at ${plan.operand}.`,
      });
    for (const path of [...matches.keys()].sort(nameOrder)) {
      const root = roots.get(path);
      if (root !== undefined) {
        root.operands.add(plan.operand);
        continue;
      }
      const entry = matches.get(path);
      if (entry !== undefined) roots.set(path, { path, entry, operands: new Set([plan.operand]) });
    }
  }

  const admitted: SelectedEntry[] = [];
  for (const root of roots.values()) {
    origins = [...root.operands];
    if (root.entry.kind === 'directory' && !options.recursive && !options.directory) {
      addIssue({
        path: root.path,
        stage: 'read',
        code: 'is-directory',
        reason: `Removing a directory requires --recursive or --dir: ${root.path}.`,
      });
      continue;
    }
    if (root.entry.kind !== 'link' && options.recursive && options.preserveRoot !== 'none') {
      if (dirname(root.path) === root.path) {
        addIssue({
          path: root.path,
          stage: 'resolve',
          code: 'preserve-root',
          reason: `Recursive removal preserves the filesystem root: ${root.path}.`,
        });
        continue;
      }
      if (options.preserveRoot === 'all') {
        const parent = yield* readEntry(dirname(root.path));
        if (parent._tag === 'Failure') {
          addIssue(issueOf(dirname(root.path), 'resolve', parent.failure));
          continue;
        }
        if (parent.success === undefined || parent.success.kind === 'link') {
          addIssue({
            path: dirname(root.path),
            stage: 'resolve',
            code: 'file-changed',
            reason: `The selected root's parent no longer identifies a directory: ${root.path}.`,
          });
          continue;
        }
        if (parent.success.info.dev !== root.entry.info.dev) {
          addIssue({
            path: root.path,
            stage: 'resolve',
            code: 'preserve-root',
            reason: `--preserve-root=all preserves a root on another device than its parent: ${root.path}.`,
          });
          continue;
        }
      }
    }
    admitted.push(root);
  }

  const above = (path: string, found: (parent: string) => boolean): string | undefined => {
    for (let parent = dirname(path); ; parent = dirname(parent)) {
      if (found(parent)) return parent;
      if (parent === dirname(parent)) return undefined;
    }
  };
  const trees = new Map<string, SelectedEntry>();
  const folded = new Map<string, SelectedEntry>();
  const kept: SelectedEntry[] = [];
  const reached = (root: SelectedEntry, tree: SelectedEntry | undefined): boolean =>
    tree !== undefined &&
    (!options.oneFileSystem || (root.entry.kind !== 'link' && tree.entry.kind !== 'link' && root.entry.info.dev === tree.entry.info.dev));
  for (const root of admitted.sort((left, right) => left.path.length - right.path.length)) {
    const holder = above(root.path, (parent) => trees.has(parent));
    if (holder !== undefined && reached(root, trees.get(holder))) {
      folded.set(root.path, root);
      continue;
    }
    kept.push(root);
    if (root.entry.kind === 'directory' && options.recursive) trees.set(root.path, root);
  }
  const nested = new Map<string, readonly string[]>();
  for (const root of folded.values()) {
    const holder = above(root.path, (parent) => nested.has(parent) || trees.has(parent));
    const inherited = holder === undefined ? [] : (nested.get(holder) ?? [...(trees.get(holder)?.operands ?? [])]);
    nested.set(root.path, sortOrigins(new Set([...inherited, ...root.operands])));
  }
  const targets: RemovalTarget[] = kept
    .sort((left, right) => removalOrder(left.path, right.path))
    .map((root) => ({
      path: root.path,
      entry: root.entry,
      operands: sortOrigins(root.operands),
      tree: root.entry.kind === 'directory' && options.recursive,
    }));
  return {
    cwd,
    options,
    targets,
    nested,
    issues: [...issues.values()].map(({ issue, operands }) => ({ ...issue, operands: sortOrigins(operands) })),
  };
});
