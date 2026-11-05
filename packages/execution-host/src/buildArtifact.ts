import { createHash } from 'node:crypto';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { Clock, Console, Data, Effect, FileSystem, Option, Path, type PlatformError as Platform, Schema } from 'effect';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import * as BunServices from '@effect/platform-bun/BunServices';
import { withFileLock } from '@runlith/file-lock/FileLock';
import { digestOf, holderEntryOf, identityOf, readArtifact } from '@runlith/executions/hostArtifacts';
import {
  ARTIFACT_FILE,
  HOLDER_ENTRY_FILE,
  ArtifactManifest,
  type ArtifactPart,
  type ArtifactRole,
} from '@runlith/executions/protocol/artifact';
import { WIRE_RANGE } from '@runlith/executions/protocol/wire';
import { bundle, type BundleOptions } from '@runlith/bundle/bundle';
import { carrier, suppliedEngine } from '@runlith/sqlite-process/artifact';
import type { CodeSigning } from './Artifact';
import { nativeRelease } from './composition/nativeBuild';
import { pipeCapability } from './nativeLaunch';
import { nativeArtifact, nativeWorkers } from './composition/artifact';

export class BuildRefused extends Data.TaggedError('BuildRefused')<{ readonly part: string; readonly detail: string }> {
  override get message(): string {
    return `${this.part}: ${this.detail}`;
  }
}

export const RUNTIME_PART = 'bun';
export const HOST_ENTRY = 'host/host.js';
export const CARRIER_ENTRY = 'host/child.ts';
export const EVIDENCE_ENTRY = 'host/worker.ts';
export const RECOVERY_ENTRY = 'recovery/recovery.js';
export const MIGRATIONS = 'drizzle';

export type BuildInput = {
  readonly root: string;
  readonly source: string;
  readonly library: string;
  readonly holder: string;
  readonly runtime?: string;
  readonly arch?: string;
  readonly build: string;
  readonly bundling?: BundleOptions;
  readonly maps?: string;
  readonly signing?: CodeSigning;
};

export type BuiltArtifact = {
  readonly root: string;
  readonly manifest: ArtifactManifest;
  readonly inputs: readonly string[];
};

const encodeManifest = Schema.encodeSync(Schema.fromJsonString(ArtifactManifest, { space: 2 }));

const refuse = (part: string, detail: string) => Effect.fail(new BuildRefused({ part, detail }));

const platformArtifact = (arch: string) =>
  Effect.suspend(() => {
    const adapter = nativeArtifact(arch);
    return adapter === undefined ? refuse('platform', `no host adapter for ${process.platform}/${arch}`) : Effect.succeed(adapter);
  });

const written = Effect.fnUntraced(function* (
  to: string,
  text: string,
  part: string,
): Effect.fn.Return<Uint8Array, BuildRefused, FileSystem.FileSystem> {
  const files = yield* FileSystem.FileSystem;
  const bytes = new TextEncoder().encode(text);
  yield* files
    .writeFile(to, bytes, { mode: 0o700 })
    .pipe(Effect.catchTag('PlatformError', (error) => refuse(part, `it could not be written: ${error.reason._tag}`)));
  return bytes;
});

type Bundled = { readonly parts: ReadonlyArray<ArtifactPart>; readonly inputs: readonly string[] };

const bundled = Effect.fnUntraced(function* (
  entry: string,
  relative: string,
  role: ArtifactRole,
  beside: ReadonlyMap<string, ArtifactRole>,
  at: (relative: string) => string,
  bundling: BundleOptions,
  maps: string | undefined,
): Effect.fn.Return<Bundled, BuildRefused, FileSystem.FileSystem | Path.Path> {
  const files = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = relative.slice(0, relative.lastIndexOf('/') + 1);
  const closure = yield* bundle(entry, relative.slice(directory.length), bundling).pipe(
    Effect.mapError((refused) => new BuildRefused({ part: relative, detail: refused.message })),
  );
  const parts: Array<ArtifactPart> = [];
  for (const [index, one] of closure.entries()) {
    const held = `${directory}${one.name}`;
    const taken = index === 0 ? role : beside.get(one.source);
    if (taken === undefined) {
      return yield* refuse(held, `${relative} starts ${one.source} beside itself, and no artifact role carries it`);
    }
    const bytes = yield* written(at(held), one.text, held);
    if (maps !== undefined && one.map !== null) {
      const map = path.join(maps, `${held}.map`);
      yield* files.makeDirectory(path.dirname(map), { recursive: true }).pipe(
        Effect.andThen(files.writeFileString(map, one.map)),
        Effect.catchTag('PlatformError', (error) => refuse(held, `its source map ${map} could not be written: ${error.reason._tag}`)),
      );
    }
    parts.push({ role: taken, path: held, bytes: bytes.length, digest: digestOf(bytes) });
  }
  return { parts, inputs: closure.flatMap((one) => one.inputs) };
});

const copied = Effect.fnUntraced(function* (
  from: string,
  outfile: string,
  part: string,
  mode: number,
): Effect.fn.Return<Uint8Array, BuildRefused, FileSystem.FileSystem> {
  const files = yield* FileSystem.FileSystem;
  yield* files.copyFile(from, outfile).pipe(
    Effect.andThen(files.chmod(outfile, mode)),
    Effect.catchTag('PlatformError', (error) => refuse(part, `${from} could not be copied: ${error.reason._tag}`)),
  );
  return yield* files
    .readFile(outfile)
    .pipe(Effect.catchTag('PlatformError', (error) => refuse(part, `its copy could not be read: ${error.reason._tag}`)));
});

const filesUnder = Effect.fnUntraced(function* (
  files: FileSystem.FileSystem,
  path: Path.Path,
  root: string,
  within = '',
): Effect.fn.Return<ReadonlyArray<string>, BuildRefused> {
  const here = within === '' ? root : path.join(root, within);
  const entries = yield* files
    .readDirectory(here)
    .pipe(Effect.catchTag('PlatformError', (error) => refuse(MIGRATIONS, `${here} could not be read: ${error.reason._tag}`)));
  const held: Array<string> = [];
  for (const entry of [...entries].sort()) {
    const relative = within === '' ? entry : `${within}/${entry}`;
    const info = yield* files
      .stat(path.join(root, relative))
      .pipe(Effect.catchTag('PlatformError', (error) => refuse(MIGRATIONS, `${relative}: ${error.reason._tag}`)));
    if (info.type === 'Directory') held.push(...(yield* filesUnder(files, path, root, relative)));
    else if (info.type === 'File') held.push(relative);
  }
  return held;
});

export const buildArtifact = Effect.fnUntraced(function* (
  input: BuildInput,
): Effect.fn.Return<BuiltArtifact, BuildRefused, FileSystem.FileSystem | Path.Path> {
  const files = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const at = (relative: string) => path.join(input.root, relative);
  const adapter = yield* platformArtifact(input.arch ?? process.arch);

  const standing = yield* files
    .exists(at(ARTIFACT_FILE))
    .pipe(Effect.catchTag('PlatformError', (error) => refuse(ARTIFACT_FILE, `${input.root} could not be read: ${error.reason._tag}`)));
  if (standing) {
    return yield* refuse(ARTIFACT_FILE, `${input.root} already holds a bundle; a closure is never rebuilt in place`);
  }
  for (const directory of ['host', 'native', 'recovery']) {
    yield* files
      .makeDirectory(at(directory), { recursive: true, mode: 0o700 })
      .pipe(Effect.catchTag('PlatformError', (error) => refuse(directory, `it could not be created: ${error.reason._tag}`)));
  }

  const parts: Array<ArtifactPart> = [];
  const part = (role: ArtifactRole, relative: string, bytes: Uint8Array) => {
    parts.push({ role, path: relative, bytes: bytes.length, digest: digestOf(bytes) });
  };

  part('runtime', RUNTIME_PART, yield* copied(input.runtime ?? process.execPath, at(RUNTIME_PART), RUNTIME_PART, 0o700));
  const engine = yield* Effect.tryPromise({
    try: () => suppliedEngine(input.arch),
    catch: (cause) => new BuildRefused({ part: 'SQLite engine', detail: String(cause) }),
  });
  const evidence = yield* files
    .realPath(path.resolve(input.source, '../performance/src/store/worker.ts'))
    .pipe(
      Effect.catchTag('PlatformError', (error) => refuse(EVIDENCE_ENTRY, `the worker source could not be resolved: ${error.reason._tag}`)),
    );
  const worker = (role: ArtifactRole, relative: string) =>
    files
      .realPath(path.join(input.source, relative))
      .pipe(Effect.catchTag('PlatformError', (error) => refuse(role, `${relative} could not be resolved: ${error.reason._tag}`)));
  const beside = new Map<string, ArtifactRole>([
    [carrier.path, carrier.role],
    [evidence, 'evidence'],
    ...(yield* Effect.forEach(nativeWorkers, (entry) => worker('sampler', entry))).map((entry) => [entry, 'sampler'] as const),
    [yield* worker('sampler', 'src/posix/terminals.worker.ts'), 'sampler'],
  ]);
  const bundling = input.bundling ?? {};
  const host = yield* bundled(path.join(input.source, 'src/main.ts'), HOST_ENTRY, 'host', beside, at, bundling, input.maps);
  parts.push(...host.parts);
  const signing = input.signing;
  const sealed = (relative: string, bytes: Uint8Array): Effect.Effect<Uint8Array, BuildRefused> =>
    signing === undefined
      ? Effect.succeed(bytes)
      : Effect.gen(function* () {
          const signed = adapter.seal(at(relative), signing);
          if (signed._tag === 'Refused') return yield* refuse(relative, `it could not be signed: ${signed.detail}`);
          return yield* files
            .readFile(at(relative))
            .pipe(
              Effect.catchTag('PlatformError', (error) => refuse(relative, `its signed bytes could not be read: ${error.reason._tag}`)),
            );
        });
  if (engine !== undefined) {
    const enginePath = `host/${engine.name}`;
    const engineBytes = yield* copied(engine.path, at(enginePath), enginePath, 0o700);
    if (digestOf(engineBytes) !== engine.digest) return yield* refuse(enginePath, 'the supplied engine moved during packaging');
    part(engine.role, enginePath, yield* sealed(enginePath, engineBytes));
  }
  const libraryPart = `native/${adapter.library}`;
  const holderPart = `native/${adapter.holder}`;
  part('platform', libraryPart, yield* sealed(libraryPart, yield* copied(input.library, at(libraryPart), libraryPart, 0o700)));
  part('holder', holderPart, yield* sealed(holderPart, yield* copied(input.holder, at(holderPart), holderPart, 0o700)));
  const recovery = yield* bundled(path.join(input.source, 'src/recovery.ts'), RECOVERY_ENTRY, 'recovery', beside, at, bundling, input.maps);
  parts.push(...recovery.parts);

  const migrations = yield* filesUnder(files, path, path.join(input.source, MIGRATIONS));
  if (migrations.length === 0) {
    return yield* refuse(MIGRATIONS, `${input.source} carries no migrations; a host cannot open its own state`);
  }
  for (const relative of migrations) {
    const held = `${MIGRATIONS}/${relative}`;
    yield* files
      .makeDirectory(path.dirname(at(held)), { recursive: true, mode: 0o700 })
      .pipe(Effect.catchTag('PlatformError', (error) => refuse(held, `it could not be created: ${error.reason._tag}`)));
    part('metadata', held, yield* copied(path.join(input.source, MIGRATIONS, relative), at(held), held, 0o600));
  }

  const declared = {
    protocol: 'executions/1' as const,
    platform: adapter.platform,
    endpoint: adapter.endpoint,
    wire: WIRE_RANGE,
    parts: parts as ReadonlyArray<ArtifactPart>,
    commands: [pipeCapability],
  };
  const manifest: ArtifactManifest = {
    identity: { digest: identityOf(declared), build: input.build },
    ...declared,
  };
  const entry = holderEntryOf(manifest);
  if (entry === undefined) return yield* refuse(HOLDER_ENTRY_FILE, 'the manifest has no valid holder launch paths');
  yield* files
    .writeFileString(at(HOLDER_ENTRY_FILE), entry, { mode: 0o600 })
    .pipe(Effect.catchTag('PlatformError', (error) => refuse(HOLDER_ENTRY_FILE, `it could not be written: ${error.reason._tag}`)));
  yield* files
    .writeFileString(at(ARTIFACT_FILE), encodeManifest(manifest), { mode: 0o600 })
    .pipe(Effect.catchTag('PlatformError', (error) => refuse(ARTIFACT_FILE, `it could not be written: ${error.reason._tag}`)));
  return { root: input.root, manifest, inputs: [...new Set([...host.inputs, ...recovery.inputs])].sort() };
});

class CacheUnavailable extends Data.TaggedError('CacheUnavailable')<{ readonly detail: string }> {}

export type Placed = { readonly root: string; readonly manifest: ArtifactManifest };

type Recipe = { readonly digest: string; readonly sources: ReadonlyArray<string> };

const CACHE = join(userInfo().homedir, '.cache', 'runlith', 'host-bundles');
const KEPT = 16;
const IDLE_MS = 60 * 60 * 1000;
const LOCK_WAIT_MS = 60_000;
const ENTRY = /^[0-9a-f]{64}$/u;
const DRAFT = /^[0-9a-f]{64}\.\d+$/u;
const TEST = /\.(?:test|itest|stest|bench|spec)\.[cm]?[jt]sx?$/u;
const WORKSPACE_FILES = ['package.json', 'bun.lock', 'bunfig.toml', 'tsconfig.json'];
const PROJECT_CONFIG = /^(?:tsconfig.*|jsconfig)\.json$/u;
const ConfigReferences = Schema.Struct({
  extends: Schema.optional(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
});
const decodeConfig = Schema.decodeUnknownEffect(ConfigReferences);

const PackageManifest = Schema.Struct({
  name: Schema.optional(Schema.String),
  dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  workspaces: Schema.optional(Schema.Struct({ packages: Schema.Array(Schema.String) })),
});
const decodePackage = Schema.decodeUnknownEffect(Schema.fromJsonString(PackageManifest));

const unavailable = (detail: string) => new CacheUnavailable({ detail });

const packageAt = Effect.fnUntraced(function* (file: string) {
  const files = yield* FileSystem.FileSystem;
  const text = yield* files.readFileString(file).pipe(Effect.mapError((error) => unavailable(`${file}: ${error.reason._tag}`)));
  return yield* decodePackage(text).pipe(Effect.mapError((error) => unavailable(`${file}: ${error.message}`)));
});

const workspacePackages = Effect.fn('buildArtifact.workspace')(function* (workspace: string, source: string) {
  const files = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const listed = (dir: string) => files.readDirectory(dir).pipe(Effect.mapError((error) => unavailable(`${dir}: ${error.reason._tag}`)));
  const patterns = (yield* packageAt(path.join(workspace, 'package.json'))).workspaces?.packages ?? [];
  const candidates: Array<string> = [];
  for (const pattern of patterns) {
    if (!pattern.endsWith('/*')) candidates.push(path.join(workspace, pattern));
    else
      for (const name of yield* listed(path.join(workspace, pattern.slice(0, -2))))
        candidates.push(path.join(workspace, pattern.slice(0, -2), name));
  }
  const named = new Map<string, { readonly dir: string; readonly dependencies: ReadonlyArray<string> }>();
  for (const dir of candidates) {
    const manifest = path.join(dir, 'package.json');
    const info = yield* files.stat(dir).pipe(Effect.mapError((error) => unavailable(`${dir}: ${error.reason._tag}`)));
    if (info.type !== 'Directory') continue;
    if (!(yield* files.exists(manifest).pipe(Effect.mapError((error) => unavailable(`${manifest}: ${error.reason._tag}`))))) continue;
    const read = yield* packageAt(manifest);
    const own = Object.entries(read.dependencies ?? {}).flatMap(([name, version]) => (version.startsWith('workspace:') ? [name] : []));
    if (read.name !== undefined) named.set(read.name, { dir, dependencies: own });
  }
  const first = (yield* packageAt(path.join(source, 'package.json'))).name;
  const reached = new Set<string>(first === undefined ? [] : [first]);
  for (const name of reached) for (const next of named.get(name)?.dependencies ?? []) reached.add(next);
  const dirs: Array<string> = [];
  for (const name of reached) {
    const found = named.get(name);
    if (found === undefined) return yield* unavailable(`${name} is not a package of the workspace at ${workspace}`);
    dirs.push(found.dir);
  }
  return dirs.sort();
});

const rootFiles = Effect.fnUntraced(function* (dir: string) {
  const files = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const failed = (error: Platform.PlatformError) => unavailable(`${dir}: ${error.reason._tag}`);
  const held: Array<string> = [];
  for (const name of yield* files.readDirectory(dir).pipe(Effect.mapError(failed))) {
    if (name !== 'package.json' && name !== 'bunfig.toml' && !PROJECT_CONFIG.test(name)) continue;
    if ((yield* files.stat(path.join(dir, name)).pipe(Effect.mapError(failed))).type === 'File') held.push(path.join(dir, name));
  }
  return held;
});

const configFiles = Effect.fn('buildArtifact.configs')(function* (roots: readonly string[]) {
  const files = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const pending = new Set(roots.filter((file) => PROJECT_CONFIG.test(path.basename(file))));
  const contents = new Map<string, Uint8Array>();
  for (const file of pending) {
    if (contents.has(file)) continue;
    const bytes = yield* files.readFile(file).pipe(Effect.mapError((error) => unavailable(`${file}: ${error.reason._tag}`)));
    contents.set(file, bytes);
    const json = yield* Effect.try({
      try: () => Bun.JSON5.parse(new TextDecoder().decode(bytes)),
      catch: (error) => unavailable(`${file}: ${String(error)}`),
    });
    const config = yield* decodeConfig(json).pipe(Effect.mapError((error) => unavailable(`${file}: ${error.message}`)));
    const inherited = typeof config.extends === 'string' ? [config.extends] : (config.extends ?? []);
    for (const reference of inherited) {
      const resolved = yield* Effect.try({
        try: () => Bun.resolveSync(reference, path.dirname(file)),
        catch: (error) => unavailable(`${file} extends ${reference}: ${String(error)}`),
      });
      const canonical = yield* files.realPath(resolved).pipe(Effect.mapError((error) => unavailable(`${resolved}: ${error.reason._tag}`)));
      pending.add(canonical);
    }
  }
  return contents;
});

const filesBelow = Effect.fnUntraced(function* (dir: string) {
  const files = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const failed = (error: Platform.PlatformError) => unavailable(`${dir}: ${error.reason._tag}`);
  if (!(yield* files.exists(dir).pipe(Effect.mapError(failed)))) return [];
  const held: Array<string> = [];
  for (const relative of yield* files.readDirectory(dir, { recursive: true }).pipe(Effect.mapError(failed))) {
    if (TEST.test(relative)) continue;
    const info = yield* files.stat(path.join(dir, relative)).pipe(Effect.mapError(failed));
    if (info.type === 'File') held.push(path.join(dir, relative));
  }
  return held;
});

const recipeOf = Effect.fn('buildArtifact.recipe')(function* (input: BuildInput) {
  const files = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspace = yield* files
    .realPath(path.resolve(input.source, '../..'))
    .pipe(Effect.mapError((error) => unavailable(`the workspace could not be resolved: ${error.reason._tag}`)));
  if (input.maps !== undefined || input.signing !== undefined || (input.bundling?.plugins?.length ?? 0) > 0)
    return yield* unavailable('source maps, signatures and plugin inputs require a direct build');
  const packages = yield* workspacePackages(workspace, input.source);
  const sources = packages.map((dir) => path.join(dir, 'src'));
  const roots = yield* rootFiles(workspace);
  const hashed = [...WORKSPACE_FILES.map((name) => path.join(workspace, name)), ...(yield* filesBelow(path.join(workspace, 'patches')))];
  for (const dir of packages) {
    roots.push(...(yield* rootFiles(dir)));
    hashed.push(...(yield* filesBelow(path.join(dir, 'src'))), ...(yield* filesBelow(path.join(dir, MIGRATIONS))));
  }
  const configs = yield* configFiles(roots);
  const named = [
    ...[...new Set([...hashed, ...roots, ...configs.keys()])].sort().map((file) => [path.relative(workspace, file), file] as const),
    ['library', input.library] as const,
    ['holder', input.holder] as const,
  ];
  const contents = yield* Effect.forEach(
    named,
    ([label, file]) =>
      (configs.has(file)
        ? Effect.succeed(configs.get(file)!)
        : files.exists(file).pipe(Effect.flatMap((present) => (present ? files.readFile(file) : Effect.succeed(new Uint8Array()))))
      ).pipe(
        Effect.map((bytes) => [label, bytes] as const),
        Effect.mapError((error) => unavailable(`${file}: ${error.reason._tag}`)),
      ),
    { concurrency: 16 },
  );
  const hash = createHash('sha256').update(
    JSON.stringify({
      platform: process.platform,
      arch: input.arch ?? process.arch,
      runtime: [input.runtime ?? process.execPath, Bun.version, Bun.revision],
      bundling: input.bundling ?? {},
    }),
  );
  for (const [label, bytes] of contents) hash.update(`\0${label}\0${bytes.length}\0`).update(bytes);
  return { digest: hash.digest('hex'), sources } satisfies Recipe;
});

const covered = (recipe: Recipe, input: string): boolean =>
  input.includes('/node_modules/') || (!TEST.test(input) && recipe.sources.some((dir) => input.startsWith(`${dir}/`)));

const placed = Effect.fn('buildArtifact.place')(function* (bundle: string, root: string, build: string) {
  const files = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const target = path.join(root, ARTIFACT_FILE);
  const standing = yield* files
    .exists(target)
    .pipe(Effect.catchTag('PlatformError', (error) => refuse(ARTIFACT_FILE, `${root} could not be read: ${error.reason._tag}`)));
  if (standing) return yield* refuse(ARTIFACT_FILE, `${root} already holds a bundle; a closure is never rebuilt in place`);
  const copyFailed = (error: Platform.PlatformError) => refuse(root, `${bundle} could not be copied: ${error.reason._tag}`);
  yield* files.makeDirectory(root, { recursive: true, mode: 0o700 }).pipe(Effect.catchTag('PlatformError', copyFailed));
  for (const name of yield* files.readDirectory(bundle).pipe(Effect.catchTag('PlatformError', copyFailed))) {
    if (name === ARTIFACT_FILE) continue;
    yield* files
      .copy(path.join(bundle, name), path.join(root, name), { overwrite: true })
      .pipe(Effect.catchTag('PlatformError', copyFailed));
  }
  const manifest = yield* readArtifact(bundle).pipe(
    Effect.mapError((failure) => new BuildRefused({ part: ARTIFACT_FILE, detail: failure._tag })),
  );
  const labelled: ArtifactManifest = { ...manifest, identity: { ...manifest.identity, build } };
  yield* files
    .writeFileString(target, encodeManifest(labelled), { mode: 0o600 })
    .pipe(Effect.catchTag('PlatformError', (error) => refuse(ARTIFACT_FILE, `it could not be written: ${error.reason._tag}`)));
  return { root, manifest: labelled } satisfies Placed;
});

const placedFrom = Effect.fnUntraced(function* (entry: string, root: string, build: string) {
  const files = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const now = new Date(yield* Clock.currentTimeMillis);
  yield* files
    .utimes(entry, now, now)
    .pipe(Effect.catchTag('PlatformError', (error) => refuse(entry, `it could not be touched: ${error.reason._tag}`)));
  return yield* placed(path.join(entry, 'bundle'), root, build);
});

const pruned = Effect.fn('buildArtifact.prune')(function* () {
  const files = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const failed = (error: Platform.PlatformError) => Effect.fail(unavailable(`${CACHE} could not be pruned: ${error.reason._tag}`));
  const idle = (yield* Clock.currentTimeMillis) - IDLE_MS;
  const dated = (name: string) =>
    files.stat(path.join(CACHE, name)).pipe(
      Effect.map((info) => [
        {
          name,
          at: Option.getOrElse(
            Option.map(info.mtime, (at) => at.getTime()),
            () => 0,
          ),
        },
      ]),
      Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed([])),
      Effect.catchTag('PlatformError', failed),
    );
  const names = yield* files.readDirectory(CACHE).pipe(Effect.catchTag('PlatformError', failed));
  const listed = (yield* Effect.forEach(
    names.filter((name) => ENTRY.test(name) || DRAFT.test(name)),
    dated,
  )).flat();
  const entries = listed.filter((one) => ENTRY.test(one.name)).sort((a, b) => b.at - a.at);
  const drafts = listed.filter((one) => DRAFT.test(one.name));
  for (const one of [...entries.slice(KEPT), ...drafts].filter((one) => one.at < idle)) {
    if (!(yield* dated(one.name)).some((now) => now.at < idle)) continue;
    const doomed = ENTRY.test(one.name) ? `${one.name}.${process.pid}` : one.name;
    if (doomed !== one.name) {
      const moved = yield* files.rename(path.join(CACHE, one.name), path.join(CACHE, doomed)).pipe(
        Effect.as(true),
        Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(false)),
        Effect.catchTag('PlatformError', failed),
      );
      if (!moved) continue;
    }
    yield* files.remove(path.join(CACHE, doomed), { recursive: true, force: true }).pipe(Effect.catchTag('PlatformError', failed));
  }
});

const published = Effect.fn('buildArtifact.publish')(function* (input: BuildInput, recipe: Recipe, entry: string) {
  const files = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const present = (at: string) =>
    files.exists(at).pipe(Effect.catchTag('PlatformError', (error) => refuse(at, `it could not be read: ${error.reason._tag}`)));
  if (yield* present(entry)) return yield* placedFrom(entry, input.root, input.build);
  const draft = `${entry}.${process.pid}`;
  const discard = Effect.orDie(files.remove(draft, { recursive: true, force: true }));
  yield* discard;
  return yield* Effect.gen(function* () {
    const built = yield* buildArtifact({ ...input, root: path.join(draft, 'bundle') });
    const after = yield* recipeOf(input);
    const uncached = (why: string) =>
      Console.error(`[execution-host] the bundle is not cached: ${why}`).pipe(
        Effect.andThen(placed(path.join(draft, 'bundle'), input.root, input.build)),
      );
    if (after.digest !== recipe.digest) return yield* uncached('its inputs changed while it was built');
    const outside = built.inputs.find((one) => !covered(after, one));
    if (outside !== undefined) return yield* uncached(`${outside} lies outside the sources its key hashes`);
    return yield* files.rename(draft, entry).pipe(
      Effect.andThen(pruned()),
      Effect.andThen(placedFrom(entry, input.root, input.build)),
      Effect.catchTag('PlatformError', (error) => uncached(`it could not be published at ${entry}: ${error.reason._tag}`)),
    );
  }).pipe(Effect.ensuring(discard));
});

const cached = Effect.fn('buildArtifact.cached')(function* (input: BuildInput) {
  const files = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const recipe = yield* recipeOf(input);
  const entry = path.join(CACHE, recipe.digest);
  const present = yield* files.exists(entry).pipe(Effect.mapError((error) => unavailable(`${entry}: ${error.reason._tag}`)));
  if (present) return yield* placedFrom(entry, input.root, input.build);
  yield* files
    .makeDirectory(CACHE, { recursive: true, mode: 0o700 })
    .pipe(Effect.mapError((error) => unavailable(`${CACHE}: ${error.reason._tag}`)));
  return yield* withFileLock(path.join(CACHE, 'lock'), LOCK_WAIT_MS, () => published(input, recipe, entry));
});

export const cachedArtifact = Effect.fnUntraced(function* (input: BuildInput) {
  const uncached = (why: string) =>
    Console.error(`[execution-host] the bundle is built without the cache: ${why}`).pipe(Effect.andThen(buildArtifact(input)));
  return yield* cached(input).pipe(
    Effect.catchTags({
      CacheUnavailable: (unavailable) => uncached(unavailable.detail),
      LockBusy: (busy) => uncached(`${busy.path} stayed held for ${busy.waitedMs} ms`),
      LockUnavailable: (lock) => uncached(`${lock.path} could not be locked: ${lock.reason}`),
    }),
  );
});

const USAGE =
  'expected the bundle directory, an optional build label, and optionally --conditions <a,b>, --inputs <file>, --maps <dir>, --sign <identity>, --arch <arm64|x64>, --runtime <bun>, --origin-from <dir> with --origin-to <dir>, and --bare';

const argumentsOf = (given: readonly string[]) => {
  const rest = [...given];
  const valued = (flag: string): string | null | undefined => {
    const at = rest.indexOf(flag);
    if (at < 0) return null;
    const value = rest[at + 1];
    rest.splice(at, 2);
    return value === undefined || value.startsWith('--') ? undefined : value;
  };
  const conditions = valued('--conditions');
  const inputs = valued('--inputs');
  const maps = valued('--maps');
  const sign = valued('--sign');
  const arch = valued('--arch');
  const runtime = valued('--runtime');
  const originFrom = valued('--origin-from');
  const originTo = valued('--origin-to');
  const bareAt = rest.indexOf('--bare');
  if (bareAt >= 0) rest.splice(bareAt, 1);
  const [root, build, ...extra] = rest;
  if (
    root === undefined ||
    conditions === undefined ||
    inputs === undefined ||
    maps === undefined ||
    sign === undefined ||
    arch === undefined ||
    runtime === undefined ||
    originFrom === undefined ||
    originTo === undefined ||
    (originFrom === null) !== (originTo === null) ||
    extra.length > 0 ||
    rest.some((one) => one.startsWith('--'))
  )
    return null;
  return {
    root,
    build,
    conditions: conditions?.split(',').filter((one) => one !== '') ?? [],
    inputs,
    maps,
    sign,
    arch,
    runtime,
    origin: originFrom === null || originTo === null ? undefined : { from: originFrom, to: originTo },
    bare: bareAt >= 0,
  };
};

export const main = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const asked = argumentsOf(process.argv.slice(2));
  if (asked === null) return yield* refuse('arguments', USAGE);
  const root = path.resolve(asked.root);
  const arch = asked.arch ?? undefined;
  const runtime = asked.runtime === null ? undefined : path.resolve(asked.runtime);
  const { source, library, holder } = yield* nativeRelease(arch).pipe(
    Effect.mapError((failure) => new BuildRefused({ part: 'platform', detail: failure.message })),
  );
  yield* Effect.sync(() => process.chdir(path.dirname(source)));
  const input: BuildInput = {
    root,
    source,
    library,
    holder,
    arch,
    runtime,
    build: asked.build ?? new Date(yield* Clock.currentTimeMillis).toISOString(),
    bundling: {
      conditions: asked.conditions,
      comments: asked.bare ? 'none' : 'kept',
      minify: asked.bare,
      sourcemap: asked.maps === null ? 'none' : 'external',
      origin: asked.origin,
    },
    maps: asked.maps === null ? undefined : path.resolve(asked.maps),
    signing: asked.sign === null ? undefined : { identity: asked.sign, timestamp: true },
  };
  const announced = (built: Placed) =>
    Effect.sync(() => {
      console.log(`${built.manifest.identity.digest} ${built.manifest.identity.build}`);
      console.log(`${built.manifest.parts.length} parts in ${built.root}`);
    });
  if (asked.inputs === null && asked.maps === null && asked.sign === null) return yield* announced(yield* cachedArtifact(input));
  const built = yield* buildArtifact(input);
  if (asked.inputs !== null) {
    const record = path.resolve(asked.inputs);
    yield* files.makeDirectory(path.dirname(record), { recursive: true }).pipe(
      Effect.andThen(files.writeFileString(record, JSON.stringify(built.inputs))),
      Effect.catchTag('PlatformError', (error) => refuse('inputs', `${record} could not be written: ${error.reason._tag}`)),
    );
  }
  yield* announced(built);
}).pipe(
  Effect.catchTag('BuildRefused', (refused) =>
    Effect.sync(() => {
      console.error(`[execution-host] ${refused.message}`);
      process.exitCode = 1;
    }),
  ),
  Effect.provide(BunServices.layer),
);

if (import.meta.main) BunRuntime.runMain(main);
