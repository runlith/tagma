import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readlink } from 'node:fs/promises';
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
const TARBALL = 'package.tgz';

const treeDigest = (root: string): Effect.Effect<string, string> =>
  Effect.tryPromise({
    try: async () => {
      const lines: string[] = [];
      const walk = async (path: string, relative: string): Promise<void> => {
        const stat = await lstat(path);
        if (stat.isSymbolicLink()) lines.push(`l ${relative} ${await readlink(path)}`);
        else if (stat.isDirectory()) {
          lines.push(`d ${relative}`);
          for (const child of (await readdir(path)).sort()) await walk(join(path, child), `${relative}/${child}`);
        } else if (stat.isFile()) {
          const hash = createHash('sha512');
          for await (const chunk of createReadStream(path)) hash.update(chunk);
          lines.push(`f ${relative} ${stat.mode & 0o111 ? 'x' : '-'} ${stat.size} ${hash.digest('base64')}`);
        } else lines.push(`? ${relative}`);
      };
      await walk(root, '');
      return createHash('sha512').update(lines.join('\n')).digest('base64');
    },
    catch: (error) => `${root} could not be digested: ${error instanceof Error ? error.message : String(error)}`,
  });

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
    yield* files.writeFile(join(work, TARBALL), bytes).pipe(Effect.mapError(unread(work)));
    const root = yield* unpacked(join(work, TARBALL), join(work, 'unpacked'), url);
    const declared = yield* files.readFileString(join(work, 'unpacked', root, 'package.json')).pipe(
      Effect.mapError(unread(`the package.json of ${url}`)),
      Effect.flatMap((json) => decodeDeclared(json).pipe(Effect.mapError((error) => `${url} declares no package: ${error.message}`))),
    );
    if (declared.name !== name || declared.version !== version) {
      return yield* Effect.fail(`${url} holds ${declared.name}@${declared.version}, not ${name}@${version}`);
    }
    yield* files.rename(join(work, TARBALL), join(work, 'unpacked', TARBALL)).pipe(Effect.mapError(unread(work)));
    const placed = yield* files.rename(join(work, 'unpacked'), into).pipe(
      Effect.as(null),
      Effect.catchTag('PlatformError', (error) => Effect.succeed(error)),
    );
    if (placed !== null) {
      const winner = yield* Effect.result(proven(into, integrity));
      if (winner._tag === 'Failure') return yield* Effect.fail(`${unread(into)(placed)}; ${winner.failure}`);
      return winner.success;
    }
    return join(into, root);
  }, Effect.scoped);

  const unpacked = Effect.fn('release.unpackPackage')(function* (tarball: string, into: string, what: string) {
    yield* files.makeDirectory(into).pipe(Effect.mapError(unread(into)));
    const answer = yield* output('/usr/bin/tar', ['-xzf', tarball, '-C', into], dirname(into), {}).pipe(
      Effect.mapError((failure) => failure.detail),
    );
    if (answer.status !== 0) return yield* Effect.fail(`${what} does not unpack: ${answer.text.trim()}`);
    const roots = yield* files.readDirectory(into).pipe(Effect.mapError(unread(into)));
    if (roots.length !== 1 || roots[0] === TARBALL) {
      return yield* Effect.fail(`${what} holds ${roots.length} entries at its root, and a package is one directory`);
    }
    return roots[0]!;
  });

  const proven = Effect.fn('release.provePackage')(function* (into: string, integrity: string) {
    const corrupt = (why: string) =>
      `${into} is a published cache entry that no longer matches its tarball (${why}); remove it and cut again`;
    const entries = yield* files.readDirectory(into).pipe(Effect.mapError(unread(into)));
    const roots = entries.filter((one) => one !== TARBALL);
    if (roots.length !== 1 || entries.length !== 2) return yield* Effect.fail(corrupt(`it holds ${entries.join(', ')}`));
    const tarball = join(into, TARBALL);
    const bytes = yield* files.readFile(tarball).pipe(Effect.mapError(unread(tarball)));
    if (integrityOf(bytes) !== integrity) return yield* Effect.fail(corrupt('its tarball differs from the integrity bun.lock names'));
    const check = yield* files
      .makeTempDirectoryScoped({ directory: dirname(into), prefix: '.verify-' })
      .pipe(Effect.mapError(unread(dirname(into))));
    const root = yield* unpacked(tarball, join(check, 'unpacked'), tarball);
    if (root !== roots[0]) return yield* Effect.fail(corrupt(`its tarball unpacks to ${root}, not ${roots[0]}`));
    const [expected, standing] = yield* Effect.all([treeDigest(join(check, 'unpacked', root)), treeDigest(join(into, root))], {
      concurrency: 2,
    });
    if (expected !== standing) return yield* Effect.fail(corrupt('its files, links or entries differ'));
    return join(into, root);
  }, Effect.scoped);

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
    const published = yield* files.exists(into).pipe(Effect.mapError(unread(into)));
    return published ? yield* proven(into, integrity) : yield* fetched(name, version, integrity, into);
  });
  return resolved;
});
