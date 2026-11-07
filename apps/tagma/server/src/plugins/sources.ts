import { isAbsolute, join, resolve } from 'node:path';
import { type CloneFailed, type CommitUnreachable, isGitUrl, shallowClone } from '@runlith/git/clone';
import { Config, Data, Effect, FileSystem, type PlatformError, Schema } from 'effect';
import { ChildProcess, type ChildProcessSpawner } from 'effect/process';
import { within } from './contract/service/reading.js';
import { npmSourceOf, type PluginSource } from './contract/wire/rows.js';

export const CLONES = 'agent-plugins';
export const DATA = 'agent-plugin-data';
const OWN = 'plugins';
const STAGING = '.staging';
const TAKEN = 'package';

export class SourceUnreadable extends Data.TaggedError('SourceUnreadable')<{ readonly reason: string }> {
  override get message(): string {
    return this.reason;
  }
}

export class PackageUnreachable extends Data.TaggedError('PackageUnreachable')<{ readonly name: string; readonly reason: string }> {
  override get message(): string {
    return `The npm package ${this.name} could not be fetched: ${this.reason}`;
  }
}

export type Fetched = {
  readonly source: PluginSource;
  readonly root: string;
  readonly stage: string | null;
};

const NPM_REGISTRY = 'https://registry.npmjs.org';

export const sourceOf = (given: string, projectRoot: string): PluginSource =>
  npmSourceOf(given) ??
  (isGitUrl(given)
    ? { kind: 'git', url: given }
    : { kind: 'folder', path: isAbsolute(given) ? resolve(given) : resolve(projectRoot, given) });

export const sameSource = (a: PluginSource, b: PluginSource): boolean => {
  switch (a.kind) {
    case 'git':
      return b.kind === 'git' && a.url === b.url && a.path === b.path;
    case 'folder':
      return b.kind === 'folder' && a.path === b.path;
    case 'npm':
      return b.kind === 'npm' && a.name === b.name;
  }
};

export const cloneRoot = (home: string, id: string): string => join(home, CLONES, id);

export const dataRoot = (home: string, id: string): string => join(home, DATA, id);

export const ownRoot = (home: string, id: string): string => join(home, OWN, id);

const unreadable = (failure: { readonly message: string }) => new SourceUnreadable({ reason: failure.message });

const directoryIn = Effect.fnUntraced(function* (base: string, path: string | undefined, label: string) {
  const files = yield* FileSystem.FileSystem;
  const asked = path === undefined ? base : resolve(base, path);
  const missing = new SourceUnreadable({ reason: `${label} holds no directory ${path ?? '.'}` });
  if (!(yield* files.exists(asked).pipe(Effect.mapError(unreadable)))) return yield* missing;
  const real = yield* files.realPath(asked).pipe(Effect.mapError(unreadable));
  if (!within(yield* files.realPath(base).pipe(Effect.mapError(unreadable)), real)) {
    return yield* new SourceUnreadable({ reason: `${path} leaves ${label}` });
  }
  if ((yield* files.stat(real).pipe(Effect.mapError(unreadable))).type !== 'Directory') return yield* missing;
  return real;
});

const staged = Effect.fnUntraced(function* (home: string) {
  const files = yield* FileSystem.FileSystem;
  yield* files.makeDirectory(join(home, CLONES, STAGING), { recursive: true }).pipe(Effect.mapError(unreadable));
  return yield* files.makeTempDirectory({ directory: join(home, CLONES, STAGING), prefix: 'stage-' }).pipe(Effect.mapError(unreadable));
});

const materialized: (
  from: string,
  into: string,
  root: string,
  chain: readonly string[],
) => Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem> = Effect.fnUntraced(function* (from, into, root, chain) {
  const files = yield* FileSystem.FileSystem;
  yield* files.makeDirectory(into, { recursive: true });
  for (const name of yield* files.readDirectory(from)) {
    const path = join(from, name);
    if (name === '.git' || !(yield* files.exists(path))) continue;
    const real = yield* files.realPath(path);
    if (!within(root, real)) continue;
    const info = yield* files.stat(real);
    if (info.type === 'File') yield* files.copyFile(real, join(into, name));
    else if (info.type === 'Directory' && !chain.some((walked) => within(real, walked))) {
      yield* materialized(real, join(into, name), root, [...chain, real]);
    }
  }
});

const copiedFrom = Effect.fnUntraced(function* (root: string, into: string) {
  yield* materialized(root, into, root, [root]).pipe(Effect.mapError(unreadable));
  return into;
});

type NpmSource = Extract<PluginSource, { readonly kind: 'npm' }>;

const Packument = Schema.Struct({
  'dist-tags': Schema.optional(Schema.Record(Schema.String, Schema.String)),
  versions: Schema.optional(Schema.Record(Schema.String, Schema.Struct({ dist: Schema.Struct({ tarball: Schema.String }) }))),
});
const decodePackument = Schema.decodeUnknownEffect(Packument);

const asked = (name: string, url: string) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url} answered ${response.status}`);
      return response;
    },
    catch: (cause) => new PackageUnreachable({ name, reason: cause instanceof Error ? cause.message : String(cause) }),
  });

const unpacked = Effect.fn('plugins.npm')(function* (source: NpmSource, stage: string) {
  const files = yield* FileSystem.FileSystem;
  const { name } = source;
  const failed = (reason: string) => new PackageUnreachable({ name, reason });
  const registry = (yield* Config.String('npm_config_registry').pipe(
    Config.withDefault(NPM_REGISTRY),
    Effect.mapError((failure) => failed(failure.message)),
  )).replace(/\/+$/u, '');
  const document = yield* asked(name, `${registry}/${name.replace('/', '%2F')}`).pipe(
    Effect.flatMap((response) =>
      Effect.tryPromise({ try: () => response.json(), catch: () => failed('its registry document is not JSON') }),
    ),
    Effect.flatMap((json) => decodePackument(json).pipe(Effect.mapError((failure) => failed(failure.message)))),
  );
  const range = source.range ?? 'latest';
  const chosen =
    document['dist-tags']?.[range] ??
    Object.keys(document.versions ?? {})
      .filter((version) => Bun.semver.satisfies(version, range))
      .sort((left, right) => Bun.semver.order(right, left))[0];
  const tarball = chosen === undefined ? undefined : document.versions?.[chosen]?.dist.tarball;
  if (tarball === undefined) return yield* failed(`no version satisfies ${range}`);
  const bytes = yield* asked(name, tarball).pipe(
    Effect.flatMap((response) => Effect.tryPromise({ try: () => response.arrayBuffer(), catch: () => failed(`${tarball} broke off`) })),
  );
  const archive = join(stage, 'package.tgz');
  const into = join(stage, 'unpacked');
  yield* files.writeFile(archive, new Uint8Array(bytes)).pipe(Effect.mapError((failure) => failed(failure.message)));
  yield* files.makeDirectory(into, { recursive: true }).pipe(Effect.mapError((failure) => failed(failure.message)));
  const exit = yield* Effect.scoped(
    Effect.flatMap(
      ChildProcess.make('tar', ['-xzf', archive, '-C', into], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }),
      (handle) => handle.exitCode,
    ),
  ).pipe(Effect.mapError((failure) => failed(`tar could not be run: ${failure.reason._tag}`)));
  if (exit !== 0) return yield* failed(`its archive did not unpack: tar exited ${exit}`);
  return into;
});

export const fetchSource = Effect.fn('plugins.fetch')(function* (
  source: PluginSource,
  home: string,
  snapshot: boolean,
): Effect.fn.Return<
  Fetched,
  SourceUnreadable | CloneFailed | CommitUnreachable | PackageUnreachable,
  FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
> {
  const files = yield* FileSystem.FileSystem;
  if (source.kind === 'folder' && !snapshot) return { source, root: yield* directoryIn(source.path, undefined, source.path), stage: null };
  const stage = yield* staged(home);
  const taken = join(stage, TAKEN);
  const copied = Effect.fnUntraced(function* (): Effect.fn.Return<
    Fetched,
    SourceUnreadable | CloneFailed | CommitUnreachable | PackageUnreachable,
    FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
  > {
    switch (source.kind) {
      case 'folder':
        return { source, root: yield* copiedFrom(yield* directoryIn(source.path, undefined, source.path), taken), stage };
      case 'git': {
        const repository = join(stage, 'repository');
        const { commit } = yield* shallowClone({ url: source.url, into: repository, ref: source.ref, commit: source.commit });
        const root = yield* copiedFrom(yield* directoryIn(repository, source.path, source.url), taken);
        yield* files.remove(repository, { recursive: true, force: true }).pipe(Effect.mapError(unreadable));
        return { source: { ...source, commit }, root, stage };
      }
      case 'npm': {
        const into = yield* unpacked(source, stage);
        const root = yield* copiedFrom(yield* directoryIn(into, 'package', source.name), taken);
        yield* files.remove(into, { recursive: true, force: true }).pipe(Effect.mapError(unreadable));
        return { source, root, stage };
      }
    }
  });
  return yield* copied().pipe(Effect.tapError(() => Effect.orDie(files.remove(stage, { recursive: true, force: true }))));
});

export const settle = Effect.fn('plugins.settle')(function* (fetched: { readonly root: string; readonly stage: string }, target: string) {
  const files = yield* FileSystem.FileSystem;
  const former = `${fetched.stage}-former`;
  const standing = yield* files.exists(target);
  yield* files.makeDirectory(join(target, '..'), { recursive: true });
  if (standing) yield* files.rename(target, former);
  yield* files.rename(fetched.root, target).pipe(Effect.tapError(() => (standing ? files.rename(former, target) : Effect.void)));
  if (standing) yield* files.remove(former, { recursive: true, force: true });
  yield* files.remove(fetched.stage, { recursive: true, force: true });
  return target;
});

export const dropStage = Effect.fn('plugins.dropStage')(function* (stage: string) {
  const files = yield* FileSystem.FileSystem;
  yield* files.remove(stage, { recursive: true, force: true });
});

export const clearStaging = Effect.fn('plugins.clearStaging')(function* (home: string) {
  const files = yield* FileSystem.FileSystem;
  yield* files.remove(join(home, CLONES, STAGING), { recursive: true, force: true });
});
