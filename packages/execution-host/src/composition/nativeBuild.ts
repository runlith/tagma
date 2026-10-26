import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { userInfo } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Data, Effect, FileSystem, Schema, type Scope } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import * as BunServices from '@effect/platform-bun/BunServices';
import { withFileLock } from '@runlith/file-lock/FileLock';
import { artifactOf, RUST_TRIPLES } from '../posix/macos/artifact';

export type NativeBuild = {
  readonly crate: string;
  readonly target: string;
  readonly triple?: string;
  readonly packages: readonly string[];
  readonly outputs: readonly string[];
  readonly flags: readonly string[];
  readonly home: string;
  readonly env: Readonly<Record<string, string | undefined>>;
};

export class NativeBuildFailed extends Data.TaggedError('NativeBuildFailed')<{ readonly detail: string }> {
  override get message(): string {
    return this.detail;
  }
}

const RECEIPT = 'tagma-native.json';
const Receipt = Schema.Struct({ sources: Schema.String, outputs: Schema.Record(Schema.String, Schema.String) });
type Receipt = typeof Receipt.Type;
const decodeReceipt = Schema.decodeUnknownResult(Schema.fromJsonString(Receipt));
const encodeReceipt = Schema.encodeEffect(Schema.fromJsonString(Receipt));

const filesUnder = Effect.fnUntraced(function* (root: string, skipped: string) {
  const pending = [root];
  const files: string[] = [];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    const entries = yield* Effect.tryPromise({
      try: () => readdir(directory, { withFileTypes: true }),
      catch: (failure) => new NativeBuildFailed({ detail: `the sources under ${directory} could not be listed: ${String(failure)}` }),
    });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (path === skipped) continue;
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  return files;
});

const flagsOf = (build: NativeBuild, home: string): readonly string[] => [...build.flags, `--remap-path-prefix=${home}=~`];

const sourcesOf = Effect.fnUntraced(function* (build: NativeBuild) {
  const fs = yield* FileSystem.FileSystem;
  const hash = createHash('sha256');
  hash.update(
    JSON.stringify({
      packages: build.packages,
      flags: flagsOf(build, '~'),
      ...(build.triple === undefined ? {} : { triple: build.triple }),
    }),
  );
  for (const file of (yield* filesUnder(build.crate, build.target)).sort()) {
    hash.update(`\0${relative(build.crate, file)}\0`);
    hash.update(
      yield* fs
        .readFile(file)
        .pipe(Effect.mapError((failure) => new NativeBuildFailed({ detail: `${file} could not be read: ${failure.message}` }))),
    );
  }
  for (let directory = dirname(build.crate); ; directory = dirname(directory)) {
    for (const name of ['Cargo.toml', 'Cargo.lock', '.cargo/config', '.cargo/config.toml', 'rust-toolchain', 'rust-toolchain.toml']) {
      const path = join(directory, name);
      const bytes = yield* fs.readFile(path).pipe(
        Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(null)),
        Effect.mapError((failure) => new NativeBuildFailed({ detail: `${path} could not be read: ${failure.message}` })),
      );
      if (bytes === null) continue;
      hash.update(`\0${relative(build.crate, path)}\0`);
      hash.update(bytes);
    }
    if (dirname(directory) === directory) break;
  }
  return hash.digest('hex');
});

const digestOf = (path: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFile(path)).pipe(
    Effect.map((bytes): string | null => createHash('sha256').update(bytes).digest('hex')),
    Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(null)),
    Effect.mapError((failure) => new NativeBuildFailed({ detail: `${path} could not be read: ${failure.message}` })),
  );

const fresh = Effect.fnUntraced(function* (build: NativeBuild, receipt: Receipt | null, sources: string) {
  if (receipt === null || receipt.sources !== sources) return false;
  const digests = yield* Effect.forEach(build.outputs, digestOf, { concurrency: 3 });
  return build.outputs.every(
    (output, index) => digests[index] !== null && receipt.outputs[relative(build.target, output)] === digests[index],
  );
});

export const nativeBuilt = Effect.fnUntraced(
  function* (
    build: NativeBuild,
  ): Effect.fn.Return<boolean, NativeBuildFailed, FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> {
    const fs = yield* FileSystem.FileSystem;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const receiptPath = join(build.target, build.triple ?? '', 'release', RECEIPT);
    const [sources, held] = yield* Effect.all(
      [
        sourcesOf(build),
        fs.readFileString(receiptPath).pipe(
          Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(null)),
          Effect.mapError((failure) => new NativeBuildFailed({ detail: `${receiptPath} could not be read: ${failure.message}` })),
        ),
      ],
      { concurrency: 2 },
    );
    const decoded = held === null ? null : decodeReceipt(held);
    const receipt = decoded?._tag === 'Success' ? decoded.success : null;
    if (yield* fresh(build, receipt, sources)) return false;
    const cargo = yield* spawner
      .spawn(
        ChildProcess.make(
          'cargo',
          [
            'build',
            '-j',
            '1',
            '--release',
            '--locked',
            ...build.packages.flatMap((name) => ['-p', name]),
            '--target-dir',
            build.target,
            ...(build.triple === undefined ? [] : ['--target', build.triple]),
          ],
          {
            cwd: build.crate,
            env: { ...build.env, CARGO_ENCODED_RUSTFLAGS: flagsOf(build, build.home).join('\x1f') },
            stdin: 'ignore',
            stdout: 'inherit',
            stderr: 'inherit',
          },
        ),
      )
      .pipe(
        Effect.mapError(
          (failure) =>
            new NativeBuildFailed({
              detail: `cargo could not be started to build ${build.crate} (${failure.message}); put the Rust toolchain on PATH of the process that builds, then build again`,
            }),
        ),
      );
    const code = yield* cargo.exitCode.pipe(
      Effect.mapError(
        (failure) => new NativeBuildFailed({ detail: `cargo in ${build.crate} could not be waited for: ${failure.message}` }),
      ),
    );
    if (code !== 0) return yield* new NativeBuildFailed({ detail: `cargo build --release in ${build.crate} ended with code ${code}` });
    const digests = yield* Effect.forEach(build.outputs, digestOf, { concurrency: 3 });
    const outputs: Record<string, string> = {};
    for (const [index, output] of build.outputs.entries()) {
      const digest = digests[index]!;
      if (digest === null)
        return yield* new NativeBuildFailed({ detail: `cargo build --release in ${build.crate} ended 0 and left no ${output}` });
      outputs[relative(build.target, output)] = digest;
    }
    const encoded = yield* encodeReceipt({ sources, outputs }).pipe(
      Effect.mapError((failure) => new NativeBuildFailed({ detail: `${receiptPath} could not be encoded: ${failure.message}` })),
    );
    yield* fs
      .writeFileString(receiptPath, encoded)
      .pipe(Effect.mapError((failure) => new NativeBuildFailed({ detail: `${receiptPath} could not be written: ${failure.message}` })));
    return true;
  },
  (effect, build) =>
    withFileLock(join(build.target, 'native.lock'), Infinity, () => Effect.scoped(effect)).pipe(
      Effect.catchTag('LockBusy', (failure) => new NativeBuildFailed({ detail: `${failure.path} stayed held for ${failure.waitedMs} ms` })),
      Effect.catchTag(
        'LockUnavailable',
        (failure) => new NativeBuildFailed({ detail: `${failure.path} could not be held for the native build: ${failure.reason}` }),
      ),
    ),
);

export const nativeRelease = Effect.fnUntraced(function* (arch?: string) {
  const adapter = artifactOf(arch ?? process.arch);
  if (process.platform !== adapter.platform.os)
    return yield* new NativeBuildFailed({ detail: `no host adapter for ${process.platform}/${arch ?? process.arch}` });
  const triple = arch === undefined ? undefined : RUST_TRIPLES[arch];
  if (arch !== undefined && triple === undefined) return yield* new NativeBuildFailed({ detail: `no Rust target for ${arch}` });
  const source = fileURLToPath(new URL('../..', import.meta.url));
  const crate = join(source, 'native');
  const target = join(crate, 'target');
  const built = join(target, triple ?? '', 'release');
  const library = join(built, adapter.library);
  const holder = join(built, adapter.holder);
  const flags = process.env.CARGO_ENCODED_RUSTFLAGS?.split('\x1f') ?? process.env.RUSTFLAGS?.split(/\s+/u) ?? [];
  yield* nativeBuilt({
    crate,
    target,
    triple,
    packages: ['execution-platform', 'execution-holder'],
    outputs: [library, holder],
    flags: flags.filter((flag) => flag !== ''),
    home: userInfo().homedir,
    env: process.env,
  });
  return { source, library, holder };
});

if (import.meta.main) BunRuntime.runMain(nativeRelease().pipe(Effect.asVoid, Effect.provide(BunServices.layer)));
