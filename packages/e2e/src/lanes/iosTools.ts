import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { withFileLock } from '@runlith/file-lock/FileLock';
import { Data, Effect, FileSystem, Schema } from 'effect';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

export const COMPANION_VERSION = '1.7.7';
export const CLIENT_VERSION = '1.7.7';
export const PYTHON_VERSION = '3.11';

type Release = { readonly companion: string; readonly client: string; readonly bridge: string; readonly python: string };
export type Tools = Release & { readonly digitizer: string };
export class ToolsUnavailable extends Data.TaggedError('ToolsUnavailable')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

type Artifact = { readonly version: string; readonly name: string; readonly sha256: string };
const companion: Artifact = {
  version: COMPANION_VERSION,
  name: 'idb-companion.macos-arm64.tar.gz',
  sha256: 'd0e4e10a7bbd85a6ce67966acb5fca0a87fd14cd026b79f8ec3ee6c338f4a166',
};
const client: Artifact = {
  version: CLIENT_VERSION,
  name: `fb_idb-${CLIENT_VERSION}-py3-none-any.whl`,
  sha256: 'df8f0babb02acb347b3da601439a2f009f3b0f74713c40c606e84c2f1294d82b',
};
const receipt = JSON.stringify({ layout: 1, companion, client, python: PYTHON_VERSION });
const preparation = 'bun packages/e2e/scripts/fetch-ios.ts';
const exec = promisify(execFile);
const unavailable = (cause: unknown): ToolsUnavailable =>
  cause instanceof ToolsUnavailable
    ? cause
    : new ToolsUnavailable({
        message: `iOS tools are unavailable; prepare them with ${preparation}: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause,
      });
const pathsIn = (directory: string): Release => ({
  companion: join(directory, 'companion', 'idb_companion'),
  client: join(directory, 'client', 'bin', 'idb'),
  bridge: join(directory, 'companion', 'Resources', 'SimulatorFrameworkBridge-iOS'),
  python: join(directory, 'client', 'bin', 'python'),
});
export const cacheDirectory = () =>
  Effect.try({
    try: () => resolve(process.env.E2E_IOS_BUILDS ?? join(userInfo().homedir, '.cache', 'runlith', 'ios-builds')),
    catch: unavailable,
  });
const location = Effect.fnUntraced(function* () {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    return yield* new ToolsUnavailable({
      message: `idb ${COMPANION_VERSION} requires macOS arm64; this host is ${process.platform}-${process.arch}`,
    });
  }
  return join(yield* cacheDirectory(), `idb-${COMPANION_VERSION}-client-${CLIENT_VERSION}-python-${PYTHON_VERSION}-macos-arm64`);
});
const executable = (path: string) => Effect.tryPromise({ try: () => access(path, constants.X_OK), catch: unavailable });
const digitizerSource = join(import.meta.dir, 'digitizer.swift');
const digitizerIn = Effect.fnUntraced(function* () {
  const files = yield* FileSystem.FileSystem;
  const digest = createHash('sha256')
    .update(yield* files.readFile(digitizerSource))
    .digest('hex')
    .slice(0, 16);
  return join(yield* cacheDirectory(), `digitizer-${digest}`);
});
const inspect = Effect.fn('e2e.inspectIosTools')(function* (directory: string) {
  const files = yield* FileSystem.FileSystem;
  const held = yield* files.readFileString(join(directory, 'complete.json'));
  if (held !== receipt)
    return yield* new ToolsUnavailable({ message: `the iOS tool cache at ${directory} does not match its pinned release` });
  const tools = pathsIn(directory);
  yield* executable(tools.companion);
  yield* executable(tools.client);
  yield* executable(tools.bridge);
  yield* executable(tools.python);
  return tools;
});
const command = Effect.fn('e2e.iosToolCommand')(function* (file: string, args: readonly string[]) {
  return yield* Effect.tryPromise({
    try: async (signal) => (await exec(file, [...args], { signal, maxBuffer: 8 * 1024 * 1024 })).stdout.trim(),
    catch: unavailable,
  });
});
const download = Effect.fn('e2e.downloadIosTool')(function* (artifact: Artifact, directory: string) {
  const files = yield* FileSystem.FileSystem;
  const path = join(directory, artifact.name);
  const url = `https://github.com/facebook/idb/releases/download/v${artifact.version}/${artifact.name}`;
  yield* command('/usr/bin/curl', ['--fail', '--location', '--silent', '--show-error', '--output', path, url]);
  const bytes = yield* files.readFile(path);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== artifact.sha256)
    return yield* new ToolsUnavailable({
      message: `${url} failed SHA-256 verification: expected ${artifact.sha256}, received ${digest}`,
    });
  return path;
});
const Python = Schema.Struct({ executable: Schema.String.check(Schema.isStartingWith('/')), version: Schema.Literal(PYTHON_VERSION) });
const install = Effect.fn('e2e.installIosTools')(function* (directory: string) {
  const files = yield* FileSystem.FileSystem;
  if (yield* files.exists(directory)) return yield* inspect(directory);
  const python = yield* command(`python${PYTHON_VERSION}`, [
    '-I',
    '-c',
    'import json,sys; print(json.dumps({"executable":sys.executable,"version":"%d.%d" % sys.version_info[:2]}))',
  ]).pipe(
    Effect.flatMap((text) => Effect.try({ try: () => JSON.parse(text), catch: unavailable })),
    Effect.flatMap(Schema.decodeUnknownEffect(Python)),
  );
  const staging = yield* files.makeTempDirectoryScoped({ directory: dirname(directory), prefix: '.idb-' });
  const ready = join(staging, 'ready');
  const distribution = join(ready, 'companion');
  const environment = join(ready, 'client');
  yield* files.makeDirectory(distribution, { recursive: true });
  const [archive, wheel] = yield* Effect.all([download(companion, staging), download(client, staging)], { concurrency: 2 });
  yield* command('/usr/bin/tar', ['-xzf', archive, '-C', distribution]);
  yield* command(python.executable, ['-I', '-m', 'venv', '--copies', environment]);
  const interpreter = join(environment, 'bin', 'python');
  yield* command(interpreter, [
    '-I',
    '-m',
    'pip',
    '--isolated',
    'install',
    '--disable-pip-version-check',
    '--no-input',
    '--no-cache-dir',
    '--only-binary=:all:',
    wheel,
  ]);
  const installed = yield* command(interpreter, [
    '-I',
    '-c',
    'from importlib.metadata import version; import idb.cli.main; print(version("fb-idb"))',
  ]);
  if (installed !== CLIENT_VERSION)
    return yield* new ToolsUnavailable({
      message: `the private Python environment installed fb-idb ${installed}, expected ${CLIENT_VERSION}`,
    });
  const launcher = pathsIn(ready).client;
  yield* files.writeFileString(
    launcher,
    '#!/bin/sh\nbin=$(/usr/bin/dirname "$0")\nexec "$bin/python" -I -m idb.cli.main --companion-path "$bin/../../companion/idb_companion" "$@"\n',
  );
  yield* files.chmod(launcher, 0o755);
  yield* files.writeFileString(join(ready, 'complete.json'), receipt);
  yield* inspect(ready);
  yield* files.rename(ready, directory);
  return pathsIn(directory);
});

const compile = Effect.fn('e2e.compileDigitizer')(function* (directory: string) {
  const files = yield* FileSystem.FileSystem;
  const binary = join(directory, 'digitizer');
  if (yield* files.exists(directory)) return binary;
  const staging = yield* files.makeTempDirectoryScoped({ directory: dirname(directory), prefix: '.digitizer-' });
  const ready = join(staging, 'ready');
  yield* files.makeDirectory(ready);
  yield* command('/usr/bin/xcrun', ['swiftc', '-O', '-swift-version', '5', '-o', join(ready, 'digitizer'), digitizerSource]);
  yield* executable(join(ready, 'digitizer'));
  yield* files.rename(ready, directory);
  return binary;
});

export const cachedTools = Effect.fn('e2e.cachedIosTools')(
  function* () {
    const release = yield* inspect(yield* location());
    const digitizer = join(yield* digitizerIn(), 'digitizer');
    yield* executable(digitizer);
    return { ...release, digitizer } satisfies Tools;
  },
  Effect.provide(BunFileSystem.layer),
  (effect) => Effect.mapError(effect, unavailable),
);

export const fetchTools = Effect.fn('e2e.fetchIosTools')(
  function* () {
    const directory = yield* location();
    const digitizer = yield* digitizerIn();
    return yield* withFileLock(`${directory}.lock`, Infinity, () =>
      Effect.gen(function* () {
        const release = yield* install(directory);
        return { ...release, digitizer: yield* compile(digitizer) } satisfies Tools;
      }),
    ).pipe(
      Effect.mapError((cause) => {
        if (cause._tag === 'LockUnavailable')
          return new ToolsUnavailable({ message: `iOS tool cache lock ${cause.path}: ${cause.reason}`, cause });
        if (cause._tag === 'LockBusy')
          return new ToolsUnavailable({ message: `iOS tool cache lock ${cause.path} remained held for ${cause.waitedMs} ms`, cause });
        return unavailable(cause);
      }),
    );
  },
  Effect.scoped,
  Effect.provide(BunFileSystem.layer),
  (effect) => Effect.mapError(effect, unavailable),
);
