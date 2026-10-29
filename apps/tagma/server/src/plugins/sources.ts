import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { spawnGit } from '@runlith/git/Git';
import { Data, Effect, FileSystem } from 'effect';
import type { ChildProcessSpawner } from 'effect/process';
import type { PluginSource } from './contract/wire/rows.js';

export const CLONES = 'plugins';
export const DATA = 'plugin-data';
const STAGING = '.staging';

const REMOTE = /^(?:https?:\/\/|ssh:\/\/|git:\/\/|file:\/\/|[\w.-]+@[\w.-]+:)/u;

export class SourceUnreadable extends Data.TaggedError('SourceUnreadable')<{ readonly reason: string }> {
  override get message(): string {
    return this.reason;
  }
}

export class CloneFailed extends Data.TaggedError('CloneFailed')<{ readonly reason: string }> {
  override get message(): string {
    return this.reason;
  }
}

export type Fetched = { readonly source: PluginSource; readonly root: string };

export const sourceOf = (given: string, projectRoot: string): PluginSource =>
  REMOTE.test(given)
    ? { kind: 'git', url: given }
    : { kind: 'folder', path: isAbsolute(given) ? resolve(given) : resolve(projectRoot, given) };

export const sameSource = (a: PluginSource, b: PluginSource): boolean =>
  a.kind === 'git' ? b.kind === 'git' && a.url === b.url : b.kind === 'folder' && a.path === b.path;

const repositoryName = (url: string): string => basename(url.replace(/\/+$/u, '').replace(/\.git$/u, '')).replace(/^.*:/u, '') || 'plugin';

export const cloneRoot = (home: string, id: string): string => join(home, CLONES, id);

export const dataRoot = (home: string, id: string): string => join(home, DATA, id);

export const fetchSource = Effect.fn('plugins.fetch')(function* (
  source: PluginSource,
  home: string,
): Effect.fn.Return<Fetched, SourceUnreadable | CloneFailed, FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner> {
  const files = yield* FileSystem.FileSystem;
  if (source.kind === 'folder') {
    const info = yield* files
      .stat(source.path)
      .pipe(Effect.mapError((failure) => new SourceUnreadable({ reason: `${source.path} could not be read: ${failure.message}` })));
    if (info.type !== 'Directory') return yield* new SourceUnreadable({ reason: `${source.path} is not a directory` });
    return {
      source,
      root: yield* files.realPath(source.path).pipe(Effect.mapError((failure) => new SourceUnreadable({ reason: failure.message }))),
    };
  }
  const failed = (failure: { readonly message: string }) => new CloneFailed({ reason: failure.message });
  yield* files.makeDirectory(join(home, CLONES, STAGING), { recursive: true }).pipe(Effect.mapError(failed));
  const stage = yield* files.makeTempDirectory({ directory: join(home, CLONES, STAGING), prefix: 'clone-' }).pipe(Effect.mapError(failed));
  const root = join(stage, repositoryName(source.url));
  const cloned = yield* spawnGit(['clone', '--depth', '1', '--', source.url, root], { extendEnv: true, capture: 4_000 }).pipe(
    Effect.mapError(failed),
  );
  if (cloned.status !== 0) {
    return yield* new CloneFailed({
      reason: `git clone ${source.url} ended ${cloned.status}: ${cloned.stderr.trim() || 'no reason printed'}`,
    });
  }
  return { source, root };
});

export const settleClone = Effect.fn('plugins.settleClone')(function* (staged: string, home: string, id: string) {
  const files = yield* FileSystem.FileSystem;
  const target = cloneRoot(home, id);
  if (staged === target) return target;
  const former = `${dirname(staged)}-former`;
  const standing = yield* files.exists(target);
  yield* files.makeDirectory(dirname(target), { recursive: true });
  if (standing) yield* files.rename(target, former);
  yield* files.rename(staged, target).pipe(Effect.tapError(() => (standing ? files.rename(former, target) : Effect.void)));
  if (standing) yield* files.remove(former, { recursive: true, force: true });
  yield* files.remove(dirname(staged), { recursive: true, force: true });
  return target;
});

export const clearStaging = Effect.fn('plugins.clearStaging')(function* (home: string) {
  const files = yield* FileSystem.FileSystem;
  yield* files.remove(join(home, CLONES, STAGING), { recursive: true, force: true });
});
