import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { Effect, FileSystem, type PlatformError, Schema } from 'effect';
import type { ChildProcessSpawner } from 'effect/process';
import { output } from './command.js';

export const REGISTRY = 'https://registry.npmjs.org';

export type PlatformPackages = (
  parent: string,
  name: string,
) => Effect.Effect<string, string, FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner>;

const Lock = Schema.Struct({ packages: Schema.Record(Schema.String, Schema.Array(Schema.Unknown)) });
const decodeLock = Schema.decodeUnknownEffect(Lock);

const Declared = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  optionalDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
const decodeDeclared = Schema.decodeUnknownEffect(Schema.fromJsonString(Declared));

const EXACT = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/u;
const INTEGRITY = 'integrity';

export const installedPackages: PlatformPackages = (parent, name) =>
  Effect.try({
    try: () => dirname(Bun.resolveSync(`${name}/package.json`, parent)),
    catch: (error) => `${name} could not be resolved beside ${parent}: ${String(error)}`,
  });

const tarballOf = (name: string, version: string, registry: string): string =>
  `${registry}/${name}/-/${name.slice(name.lastIndexOf('/') + 1)}-${version}.tgz`;

const integrityOf = (bytes: Uint8Array): string => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;

export const lockedPackages = Effect.fn('release.lockedPackages')(function* (checkout: string, cache: string, registry: string = REGISTRY) {
  const files = yield* FileSystem.FileSystem;
  const unread = (what: string) => (error: PlatformError.PlatformError) => `${what} could not be read: ${error.reason._tag}`;
  const lockPath = join(checkout, 'bun.lock');
  const text = yield* files.readFileString(lockPath).pipe(Effect.mapError(unread(lockPath)));
  const parsed = yield* Effect.try({ try: () => Bun.JSON5.parse(text), catch: (error) => `${lockPath} does not parse: ${String(error)}` });
  const lock = yield* decodeLock(parsed).pipe(Effect.mapError((error) => `${lockPath} is not a Bun lockfile: ${error.message}`));
  const integrities = new Map<string, string>();
  for (const entry of Object.values(lock.packages)) {
    const [ident, , , integrity] = entry;
    if (typeof ident === 'string' && typeof integrity === 'string' && integrity.startsWith('sha512-')) integrities.set(ident, integrity);
  }

  const fetched = Effect.fn('release.fetchPackage')(function* (name: string, version: string, integrity: string, into: string) {
    const url = tarballOf(name, version, registry);
    const bytes = yield* Effect.tryPromise({
      try: async () => {
        const answer = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
        if (!answer.ok) throw new Error(`answered ${answer.status}`);
        return new Uint8Array(await answer.arrayBuffer());
      },
      catch: (error) => `${url} could not be read: ${error instanceof Error ? error.message : String(error)}`,
    });
    if (integrityOf(bytes) !== integrity)
      return yield* Effect.fail(`${url} does not match the integrity bun.lock names for ${name}@${version}`);
    yield* files.makeDirectory(dirname(into), { recursive: true }).pipe(Effect.mapError(unread(dirname(into))));
    const work = yield* files
      .makeTempDirectoryScoped({ directory: dirname(into), prefix: '.fetch-' })
      .pipe(Effect.mapError(unread(dirname(into))));
    yield* files.writeFile(join(work, 'package.tgz'), bytes).pipe(Effect.mapError(unread(work)));
    yield* files.makeDirectory(join(work, 'unpacked')).pipe(Effect.mapError(unread(work)));
    const unpacked = yield* output('/usr/bin/tar', ['-xzf', join(work, 'package.tgz'), '-C', join(work, 'unpacked')], work, {}).pipe(
      Effect.mapError((failure) => failure.detail),
    );
    if (unpacked.status !== 0) return yield* Effect.fail(`${url} does not unpack: ${unpacked.text.trim()}`);
    const roots = yield* files.readDirectory(join(work, 'unpacked')).pipe(Effect.mapError(unread(work)));
    if (roots.length !== 1) return yield* Effect.fail(`${url} holds ${roots.length} directories at its root, and a package is one`);
    const declared = yield* files.readFileString(join(work, 'unpacked', roots[0]!, 'package.json')).pipe(
      Effect.mapError(unread(`the package.json of ${url}`)),
      Effect.flatMap((json) => decodeDeclared(json).pipe(Effect.mapError((error) => `${url} declares no package: ${error.message}`))),
    );
    if (declared.name !== name || declared.version !== version) {
      return yield* Effect.fail(`${url} holds ${declared.name}@${declared.version}, not ${name}@${version}`);
    }
    yield* files.writeFileString(join(work, 'unpacked', INTEGRITY), integrity).pipe(Effect.mapError(unread(work)));
    const placed = yield* files.rename(join(work, 'unpacked'), into).pipe(
      Effect.as(null),
      Effect.catchTag('PlatformError', (error) => Effect.succeed(error)),
    );
    if (placed !== null && (yield* keptIntegrity(into)) !== integrity) return yield* Effect.fail(unread(into)(placed));
    return join(into, roots[0]!);
  }, Effect.scoped);

  const keptIntegrity = (into: string) =>
    files.readFileString(join(into, INTEGRITY)).pipe(
      Effect.map((kept): string | null => kept),
      Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(null)),
      Effect.mapError(unread(into)),
    );

  const resolved: PlatformPackages = Effect.fn('release.platformPackage')(function* (parent: string, name: string) {
    const manifest = join(parent, 'package.json');
    const declaring = yield* files.readFileString(manifest).pipe(
      Effect.mapError(unread(manifest)),
      Effect.flatMap((json) => decodeDeclared(json).pipe(Effect.mapError((error) => `${manifest} declares no package: ${error.message}`))),
    );
    const version = declaring.optionalDependencies?.[name] ?? declaring.dependencies?.[name];
    if (version === undefined || !EXACT.test(version)) {
      return yield* Effect.fail(`${declaring.name} at ${parent} pins no exact version of ${name}: ${version ?? 'it is not a dependency'}`);
    }
    const integrity = integrities.get(`${name}@${version}`);
    if (integrity === undefined) return yield* Effect.fail(`bun.lock names no integrity of ${name}@${version}`);
    const into = join(cache, `${name}@${version}`);
    const standing = yield* keptIntegrity(into);
    if (standing === integrity) {
      const roots = yield* files.readDirectory(into).pipe(Effect.mapError(unread(into)));
      const root = roots.find((one) => one !== INTEGRITY);
      if (root !== undefined) return join(into, root);
    }
    if (standing !== null) yield* files.remove(into, { recursive: true, force: true }).pipe(Effect.mapError(unread(into)));
    return yield* fetched(name, version, integrity, into);
  });
  return resolved;
});
