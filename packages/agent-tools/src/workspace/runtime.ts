import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { Duration, Effect, FileSystem, Option, type PlatformError } from 'effect';
import { declare, type Held } from '@runlith/held/Held';
import type { PermissionSubject } from '@runlith/agent/permissions';
import { pathSubject } from '@runlith/agent/permissions/pathSubject';
import { type Claim, ToolFailed } from '@runlith/agent/tool';
import { WorkspaceRefused, prepareToolEffect } from '../ToolEdge';
import { fileFailure, resourcePath } from '@runlith/files/replace';
import { isWithin, workspaceKey, workspaceTarget } from './paths';
import { aliasRefusal, entryIdentity, isLink, orAbsent, storedOf } from '../namespace';
import { displayPath } from '../display';
import { refused } from '../refusals';
import type { PreparedPath, ResolvedToolOptions, ToolFactoryOptions } from '../workspace';

export function resolveToolOptions(options: ToolFactoryOptions): ResolvedToolOptions {
  if (!options.cwd || !isAbsolute(options.cwd)) {
    throw new Error('ToolFactoryOptions.cwd must be a non-empty absolute path.');
  }
  const resolved: ResolvedToolOptions = {
    cwd: resolve(options.cwd),
    allowOutsideCwd: options.allowOutsideCwd ?? false,
    world: options.world,
    changes: options.changes,
    bindings: options.bindings,
    unowned: options.unowned ?? [],
    comments: options.comments ?? (() => Effect.succeed('allowed')),
    checkout: options.checkout ?? (() => Effect.succeed('shared')),
    checkoutAt: options.checkoutAt ?? (() => Effect.succeed(true)),
    env: options.env ?? {},
    callEnv: options.callEnv ?? (() => ({})),
    commandTimes: options.commandTimes,
    searchMs: options.searchMs,
    at: (caller) => (options.changesOf === undefined ? resolved : { ...resolved, changes: options.changesOf(caller) }),
  };
  return resolved;
}

const resolvedName = Effect.fn('resolvedName')(function* (target: string) {
  const fs = yield* FileSystem.FileSystem;
  const real = yield* orAbsent(fs.realPath(target));
  if (real !== undefined) return real;
  if (yield* isLink(target)) return null;
  return join(yield* resourcePath(dirname(target)), basename(target));
});

const bindingOf = (resolved: ResolvedToolOptions, target: string, entry = false): Effect.Effect<string | null, ToolFailed> => {
  const { bindings, world } = resolved;
  if (bindings === undefined || world.files === undefined) return Effect.succeed(null);
  const named = entry ? Effect.map(realParent(target), (parent) => join(parent, basename(target))) : resolvedName(target);
  return named.pipe(
    Effect.provide(world.files),
    Effect.map((real) => bindings.of(target, real)),
    Effect.mapError((error) =>
      error instanceof ToolFailed
        ? error
        : new ToolFailed({
            reason: `Cannot resolve ${displayPath(resolved.cwd, target)}: ${fileFailure(error)}. This path was not changed.`,
          }),
    ),
  );
};

const unresolved =
  (resolved: ResolvedToolOptions, target: string) =>
  (error: PlatformError.PlatformError): ToolFailed =>
    new ToolFailed({
      reason: `Cannot resolve ${displayPath(resolved.cwd, target)}: ${fileFailure(error)}. This path was not changed.`,
    });

const bindingAgain = (resolved: ResolvedToolOptions, prepared: PreparedPath): Effect.Effect<string | null, ToolFailed> => {
  const { bindings, world } = resolved;
  if (prepared.resource === null) return bindingOf(resolved, prepared.target, prepared.entry === true);
  if (bindings === undefined || world.files === undefined) return Effect.succeed(null);
  return resourcePath(prepared.target).pipe(
    Effect.provide(world.files),
    Effect.map((real) => bindings.of(prepared.target, real)),
    Effect.mapError(unresolved(resolved, prepared.target)),
  );
};

export const preparedPath = Effect.fn('preparedPath')(function* (
  resolved: ResolvedToolOptions,
  candidate: string | undefined,
  kind: PermissionSubject['kind'],
  entry = false,
) {
  const target = workspaceTarget(resolved.cwd, candidate);
  const files = resolved.world.files;
  const resource =
    entry || kind !== 'write' || files === undefined
      ? null
      : yield* prepareToolEffect(
          files,
          Effect.gen(function* () {
            const identity = yield* entryIdentity(target);
            if (identity.kind === 'alias' || identity.kind === 'taken')
              return yield* refused('aliased', aliasRefusal(resolved.cwd, target, storedOf(identity)));
            return yield* Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const path = yield* resolvedName(target);
              if (path === null)
                return yield* refused(
                  'dangling-link',
                  `${displayPath(resolved.cwd, target)} is a dangling symlink. Read the link and write to its destination path. Nothing was changed.`,
                );
              return { path, root: yield* fs.realPath(resolved.cwd) };
            }).pipe(Effect.mapError((error) => (error instanceof ToolFailed ? error : unresolved(resolved, target)(error))));
          }),
        );
  const binding = resource === null ? yield* bindingOf(resolved, target, entry) : (resolved.bindings?.of(target, resource.path) ?? null);
  return {
    path: { target, resource, binding, entry: entry ? true : undefined } satisfies PreparedPath,
    subject: {
      ...pathSubject(kind, resolved.cwd, resource?.path ?? target),
      entry: entry ? true : undefined,
    } satisfies PermissionSubject,
  };
});

const canonicalPaths = (target: string, entry: boolean) =>
  entry
    ? Effect.map(realParent(target), (parent) => [join(parent, basename(target))])
    : Effect.map(resourcePath(target), (resolved) => [resolved]);

export const pathClaims = Effect.fn('pathClaims')(function* (
  resolved: ResolvedToolOptions,
  candidates: readonly (string | undefined)[],
  access: Claim['access'],
  entry = false,
) {
  const files = resolved.world.files;
  const claims: Claim[] = [];
  for (const candidate of candidates) {
    const target = workspaceTarget(resolved.cwd, candidate);
    const paths =
      files === undefined
        ? [target]
        : yield* prepareToolEffect(files, canonicalPaths(target, entry)).pipe(Effect.mapError(unresolved(resolved, target)));
    for (const path of paths) claims.push({ on: { kind: 'file', path }, access });
  }
  return claims;
});

export const namedPath = Effect.fn('namedPath')(function* (argument: string, candidate: string) {
  if (candidate === '') {
    return yield* refused('call-shape', `${argument} is required and names nothing here.`);
  }
  return candidate;
});

export const pathPreparation = Effect.fn('pathPreparation')(function* (
  resolved: ResolvedToolOptions,
  candidate: string | undefined,
  kind: PermissionSubject['kind'],
  entry = false,
) {
  const { path, subject } = yield* preparedPath(resolved, candidate, kind, entry);
  return { subjects: [subject] as readonly PermissionSubject[], prepared: path };
});

const fileWriters: Held<string, never> = declare<string>({
  name: 'agent-tools-file-writer',
  owner: 'agent-tools',
  rank: 261,
  key: (key) => key,
  concurrency: 1,
  threshold: Duration.seconds(10),
  ceilings: 'none',
  external: 'none',
});

const directories: Held<string, never> = declare<string>({
  name: 'agent-tools-directory',
  owner: 'agent-tools',
  rank: 260,
  key: (key) => key,
  concurrency: 1,
  threshold: Duration.seconds(10),
  ceilings: 'none',
  external: 'none',
});

export const entryKey = Effect.fn('entryKey')(function* (root: string, path: string) {
  const spelled = workspaceKey(root, path);
  return join(yield* realParent(spelled), basename(spelled));
});

export function withFileWriteLock<A, E, R>(
  root: string,
  path: string,
  work: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | PlatformError.PlatformError, R | FileSystem.FileSystem> {
  return Effect.flatMap(entryKey(root, path), (key) => fileWriters.hold(key, work));
}

export function withFileWriteLocks<A, E, R>(
  root: string,
  paths: readonly string[],
  work: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | PlatformError.PlatformError, R | FileSystem.FileSystem> {
  return Effect.flatMap(
    Effect.forEach(paths, (path) => entryKey(root, path)),
    (keys) => fileWriters.holdAll(keys, work),
  );
}

export function withDirectoryLock<A, E, R>(parent: string, work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  return directories.hold(parent, work);
}

export function withDirectoryLocks<A, E, R>(parents: readonly string[], work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  return directories.holdAll([...parents], work);
}

export function withNamedEntries<A, E, R>(
  parents: readonly string[],
  keys: readonly string[],
  work: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return directories.holdAll([...parents], fileWriters.holdAll(keys, work));
}

export function withNamedEntry<A, E, R>(
  root: string,
  path: string,
  work: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | PlatformError.PlatformError, R | FileSystem.FileSystem> {
  return Effect.flatMap(entryKey(root, path), (key) => directories.hold(dirname(key), fileWriters.hold(key, work)));
}

const standsAt = (path: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => Effect.map(orAbsent(fs.stat(path)), (info) => info !== undefined));

export function withEntryWrite<A, E, R>(
  root: string,
  path: string,
  work: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | PlatformError.PlatformError, R | FileSystem.FileSystem> {
  return Effect.flatMap(entryKey(root, path), (key) => {
    const named = directories.hold(dirname(key), fileWriters.hold(key, work));
    return Effect.flatMap(standsAt(key), (stands) =>
      stands
        ? Effect.flatMap(
            fileWriters.hold(
              key,
              Effect.flatMap(standsAt(key), (still) => (still ? Effect.asSome(work) : Effect.succeedNone)),
            ),
            (written) => (Option.isSome(written) ? Effect.succeed(written.value) : named),
          )
        : named,
    );
  });
}

export type PathAdmission = { readonly allowMissing?: boolean; readonly entry?: true };

export const resolveWorkspacePath = (resolved: ResolvedToolOptions, candidate: string, options: PathAdmission = {}) =>
  fenceWorkspacePath(resolved, workspaceTarget(resolved.cwd, candidate), options, candidate);

export const fenceWorkspacePath = Effect.fn('fenceWorkspacePath')(function* (
  resolved: ResolvedToolOptions,
  target: string,
  options: PathAdmission = {},
  attempted: string = target,
) {
  if (resolved.allowOutsideCwd) return target;
  const fs = yield* FileSystem.FileSystem;
  const realCwd = yield* fs.realPath(resolved.cwd);
  if (!isWithin([resolved.cwd, realCwd], target)) {
    return yield* new WorkspaceRefused({ attempted, root: resolved.cwd });
  }
  const existing = options.entry === true ? target : (options.allowMissing ?? false) ? yield* nearestExistingPath(target) : target;
  const realTarget = options.entry === true ? join(yield* resourcePath(dirname(target)), basename(target)) : yield* fs.realPath(existing);
  if (!isWithin([realCwd], realTarget)) {
    return yield* new WorkspaceRefused({ attempted: target, root: resolved.cwd });
  }
  return target;
});

export const admitPreparedPath = Effect.fn('admitPreparedPath')(function* (
  resolved: ResolvedToolOptions,
  prepared: PreparedPath | undefined,
  options: PathAdmission = {},
) {
  if (prepared === undefined) {
    return yield* new ToolFailed({
      reason:
        'This call was admitted without the resolution it was judged over, so what it may touch cannot be established. Call it again so it is resolved and allowed together.',
    });
  }
  if (prepared.binding !== null && (yield* bindingAgain(resolved, prepared)) !== prepared.binding) {
    return yield* new ToolFailed({
      reason: `${prepared.target} cannot be established as the resource this call was allowed over. Call it again so it is resolved and allowed together.`,
    });
  }
  if (prepared.resource === null)
    return yield* fenceWorkspacePath(resolved, prepared.target, { allowMissing: options.allowMissing, entry: prepared.entry });
  if (!resolved.allowOutsideCwd) {
    if (!isWithin([resolved.cwd], prepared.target)) return yield* new WorkspaceRefused({ attempted: prepared.target, root: resolved.cwd });
    if (!isWithin([prepared.resource.root], prepared.resource.path))
      return yield* new WorkspaceRefused({ attempted: prepared.target, root: resolved.cwd });
  }
  return prepared.resource.path;
});

export const realParent = Effect.fn('realParent')(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  const parent = dirname(path);
  return (yield* orAbsent(fs.realPath(parent))) ?? parent;
});

const nearestExistingPath = Effect.fn('nearestExistingPath')(function* (target: string) {
  const fs = yield* FileSystem.FileSystem;
  let current = target;
  for (;;) {
    const found = (yield* orAbsent(fs.stat(current))) !== undefined;
    if (found) return current;
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
});
