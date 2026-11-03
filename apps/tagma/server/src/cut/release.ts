import { Clock, Data, Effect, FileSystem, type PlatformError, Schema } from 'effect';
import type { ChildProcessSpawner } from 'effect/process';
import { realpathSync } from 'node:fs';
import { basename, dirname, relative as relativePath, resolve } from 'node:path';
import { sealRelease } from './sealing.js';
import { capturedSource } from './source.js';
import type { CapturedSource } from '../installation/contract/wire/capture.js';
import { bundle } from '@runlith/bundle/bundle';
import { buildEngine } from '@runlith/sqlite-process/artifact';
import { Git } from '@runlith/git/Git';
import { verifyArtifact } from '@runlith/executions/hostArtifacts';
import { type GitAnswerInvalid, type GitRefused, type GitUnreadable, troubleOf } from '@runlith/git/repository';
import { gitCut, gitText, gitTree } from '../platform/git/readings.js';
import type { Composition } from './descriptor.js';
import { hostBinary } from '../mac-applications/bundle.js';
import {
  SURFACE_INDEX,
  CLI_ENTRY,
  RUNTIME_PART,
  SIGNING_IDENTITY_ENV,
  HOST_ASSETS_ENV,
  HOST_CHANNEL_ENV,
  BUILD_CONDITIONS_ENV,
  BUILD_INPUTS_ENV,
  BUILD_MAPS_ENV,
  RELEASE_NUMBER_ENV,
  BUILD_TARGET_ENV,
  revisionLabel,
  sourceMapOriginIn,
} from '../installation/contract/wire/layout.js';
import {
  CLOSURE_LAYOUT,
  DESKTOP,
  EVIDENCE_MIGRATIONS,
  ACTIVITY_MIGRATIONS,
  EXECUTIONS,
  type InstallationManifest,
  type InstallationRole,
  type InstallationPlatform,
  type InstallationProvenance,
  type IrreversibleChange,
  MIGRATIONS,
  PACKAGE_FILE,
  SERVER_ENTRY,
  STORE_MIGRATIONS,
  SURFACE,
} from '../installation/contract/wire/manifest.js';
import { partsAt } from '../installation/closure/read.js';
import { writeInstallation } from '../installation/closure/write.js';
import { LauncherWriteFailed, type LauncherWritten, writeLauncher, writeLauncherBeside } from '../installation/setup/launcher.js';
import { type SigningIdentity, signingIdentity, signingNotice } from './signing.js';
import { HOST_REFUSAL_ENV, HostRefusal } from '../installation/contract/wire/hostRefusal.js';
import { type CommandUnavailable, output } from './command.js';
import { carriedEngine, engineLayout } from './engine.js';
import { carryNative, nativeCarried, writeInstallationPackage } from './packages.js';
import { stamped } from '../installation/closure/versions.js';
import { nextVersion, openVersion } from '../platform/lock/versionedDirectories.js';
import type { Claimed } from '../installation/closure/leases.js';
import {
  type AttemptStanding,
  type InstallHeld,
  madeCurrent,
  type MoveFailed,
  moveFrom,
  moving,
  published,
  staging,
} from '../installation/closure/moves.js';
import type { RecordUnreadable } from '../installation/closure/attempt.js';
import { carrySkills, skillInputs } from './skills.js';
import { carryRipgrep, carryTypescript } from './tools.js';
import { installedPackages, lockedPackages } from './locked.js';
import { type Target, targetName, targetTrouble } from './target.js';
import { PROGRAM_FEED_DEFINE, PROGRAM_RELEASE_DEFINE } from '../platform/contract/wire/program.js';

export const RELEASE_LOG = 'release.log';

export type ReleaseCut = {
  readonly number: string;
  readonly signer: SigningIdentity;
  readonly maps: string;
  readonly inputs: string;
  readonly irreversible: readonly IrreversibleChange[];
  readonly target: Target;
  readonly runtime: string;
  readonly packages: string;
};

export const PROGRAM_INPUTS = 'program.json';
export const EXECUTIONS_INPUTS = `${EXECUTIONS}.json`;
export const INPUT_RECORDS = [PROGRAM_INPUTS, `${SURFACE}.json`, `${DESKTOP}.json`, EXECUTIONS_INPUTS] as const;

const producedBy = (release: ReleaseCut | null, producer: string): Record<string, string> =>
  release === null
    ? {}
    : {
        [BUILD_MAPS_ENV]: `${release.maps}/${producer}`,
        [BUILD_INPUTS_ENV]: `${release.inputs}/${producer}.json`,
        [RELEASE_NUMBER_ENV]: release.number,
        [BUILD_TARGET_ENV]: targetName(release.target),
      };

export class ReleaseRefused extends Data.TaggedError('ReleaseRefused')<{
  readonly step: string;
  readonly detail: string;
  readonly log: string;
  readonly unblock: readonly string[];
}> {}

export type ReleaseLanded<Launcher = LauncherWritten> = {
  readonly version: string;
  readonly root: string;
  readonly manifest: InstallationManifest;
  readonly launcher: Launcher;
  readonly log: string;
  readonly previous: string | null;
};

type Spawner = ChildProcessSpawner.ChildProcessSpawner;

const said = (line: string): Effect.Effect<void> => Effect.sync(() => console.log(`[tagma] ${line}`));

const took = (from: number): Effect.Effect<string> => Effect.map(Clock.currentTimeMillis, (now) => `${((now - from) / 1000).toFixed(1)}s`);

const NAMED_PATH_MAX = 240;

const HOST_REFUSAL_FILE = 'host-refusal.json';

const decodeRefusal = Schema.decodeUnknownResult(Schema.fromJsonString(HostRefusal));

const unrunnable = (failure: CommandUnavailable): HostRefusal => ({ detail: failure.detail, unblock: failure.unblock });

type Written = { readonly written: readonly string[]; readonly inputs: readonly string[] };

const importOf = (from: string, to: string): RegExp => {
  const path = relativePath(dirname(from), to).replace(/\.ts$/, '.js');
  const specifier = path.startsWith('.') ? path : `./${path}`;
  return new RegExp(`^${specifier.replaceAll(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`);
};

const bundled = Effect.fnUntraced(function* (
  entry: string,
  outfile: string,
  external: { readonly from: RegExp; readonly to: string } | null,
  composition: Composition,
  carried: readonly string[],
  release: { readonly cut: ReleaseCut; readonly root: string } | null,
): Effect.fn.Return<Written, string, FileSystem.FileSystem> {
  const files = yield* FileSystem.FileSystem;
  const { checkout } = composition.roots;
  let rewrote = 0;
  const closure = yield* bundle(entry, basename(outfile), {
    sourcemap: 'external',
    origin: sourceMapOriginIn(process.env),
    comments: release === null ? 'kept' : 'none',
    minify: release !== null,
    define: {
      ...(composition.feed === null ? {} : { [PROGRAM_FEED_DEFINE]: JSON.stringify(composition.feed) }),
      ...(release === null ? {} : { [PROGRAM_RELEASE_DEFINE]: JSON.stringify(release.cut.number) }),
    },
    conditions: composition.conditions,
    external: carried,
    plugins:
      external === null
        ? [...composition.plugins]
        : [
            ...composition.plugins,
            {
              name: 'closure-entry',
              setup(plugin) {
                plugin.onResolve({ filter: external.from }, (asked) => {
                  if (resolve(asked.importer) !== resolve(entry)) return undefined;
                  rewrote += 1;
                  return { path: external.to, external: true };
                });
              },
            },
          ],
  }).pipe(Effect.mapError((refused) => refused.message));
  if (external !== null && rewrote === 0) {
    return yield* Effect.fail(`nothing in ${entry} imports ${external.to}; the closure's entries would not find each other`);
  }
  const written: string[] = [];
  for (const one of closure) {
    const escaped = one.text.indexOf(checkout);
    if (escaped >= 0) {
      const closing = one.text.indexOf('"', escaped);
      const ends = Math.min(closing === -1 ? one.text.length : closing, escaped + NAMED_PATH_MAX);
      return yield* Effect.fail(
        `${one.source} names ${one.text.slice(escaped, ends)} — a path in the checkout, which a closure may not read`,
      );
    }
    const to = `${dirname(outfile)}/${one.name}`;
    const map = one.map === null ? null : release === null ? `${to}.map` : `${release.cut.maps}/${relativePath(release.root, to)}.map`;
    yield* Effect.gen(function* () {
      yield* files.writeFile(to, new TextEncoder().encode(one.text), { mode: 0o700 });
      if (map === null || one.map === null) return;
      yield* files.makeDirectory(dirname(map), { recursive: true });
      yield* files.writeFileString(map, one.map);
    }).pipe(Effect.catchTag('PlatformError', (error: PlatformError.PlatformError) => Effect.fail(`${to}: ${error.reason._tag}`)));
    written.push(to);
    if (release === null && map !== null) written.push(map);
  }
  return { written, inputs: closure.flatMap((one) => one.inputs) };
});

const WATCH_ENGINE = 'watch.native';

const labelled = Effect.fnUntraced(function* (
  git: Git['Service'],
  checkout: string,
  version: string,
  captured: CapturedSource | null,
): Effect.fn.Return<{ readonly build: string; readonly tree: string | undefined }, GitUnreadable | GitRefused | GitAnswerInvalid, Spawner> {
  if (captured !== null) {
    const short =
      captured.head === null ? null : ((yield* gitText(git, checkout, ['rev-parse', '--short', captured.head])) ?? captured.head).trim();
    return {
      build: `${revisionLabel(short === null ? null : { head: short, dirty: captured.dirty })} ${version}`,
      tree: captured.tree ?? undefined,
    };
  }
  const [cut, tree] = yield* Effect.all([gitCut(git, checkout), gitTree(git, checkout)], { concurrency: 'unbounded' });
  return {
    build: `${revisionLabel(cut === null ? null : { head: cut.head, dirty: tree.changed > 0 })} ${version}`,
    tree: tree.fingerprint ?? undefined,
  };
});

type Unswapped = { root: string | null; release: () => void; readonly swapped: (version: string) => void };

const releaseWith = <Launcher>(
  installRoot: string,
  composition: Composition,
  writing: (platform: InstallationPlatform) => Effect.Effect<Launcher, LauncherWriteFailed, FileSystem.FileSystem>,
  origin: InstallationProvenance | null | undefined = undefined,
  swapped: (version: string) => void = () => undefined,
  release: ReleaseCut | null = null,
): Effect.Effect<ReleaseLanded<Launcher>, ReleaseRefused, FileSystem.FileSystem | Spawner | Git> =>
  Effect.suspend(() => {
    const unswapped: Unswapped = { root: null, release: () => undefined, swapped };
    return releasing(unswapped, installRoot, composition, writing, origin, release).pipe(
      Effect.onInterrupt(() => {
        const root = unswapped.root;
        return root === null
          ? Effect.void
          : Effect.flatMap(FileSystem.FileSystem, (files) => files.remove(root, { recursive: true, force: true })).pipe(
              Effect.tapError((failure) => Effect.logWarning('Interrupted release left its unfinished directory', { root, failure })),
              Effect.ignore,
            );
      }),
      Effect.ensuring(Effect.sync(() => unswapped.release())),
    );
  });

const releasing = Effect.fnUntraced(function* <Launcher>(
  unswapped: Unswapped,
  installRoot: string,
  composition: Composition,
  writing: (platform: InstallationPlatform) => Effect.Effect<Launcher, LauncherWriteFailed, FileSystem.FileSystem>,
  origin: InstallationProvenance | null | undefined,
  release: ReleaseCut | null,
): Effect.fn.Return<ReleaseLanded<Launcher>, ReleaseRefused, FileSystem.FileSystem | Spawner | Git> {
  const { conditions, roots, client, entries } = composition;
  const sourcePath = roots.server;
  const files = yield* FileSystem.FileSystem;
  const git = yield* Git;
  const log = `${installRoot}/${RELEASE_LOG}`;
  const builder = process.execPath;
  const runtime = release === null ? builder : release.runtime;
  const platform = release === null ? { os: process.platform, arch: process.arch } : release.target;
  const platformName = `${platform.os}-${platform.arch}`;

  const opened = yield* Effect.result(files.makeDirectory(installRoot, { recursive: true }));
  if (opened._tag === 'Failure') {
    return yield* Effect.fail(
      new ReleaseRefused({ step: 'install root', detail: `${installRoot}: ${opened.failure.reason._tag}`, log: '', unblock: [] }),
    );
  }
  const before =
    release === null
      ? ''
      : yield* files.readFileString(log).pipe(
          Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed('')),
          Effect.mapError(
            (failure) =>
              new ReleaseRefused({
                step: 'install root',
                detail: `${log} could not be read: ${failure.reason._tag}`,
                log: '',
                unblock: [],
              }),
          ),
        );

  let logged = `${before}release ${platformName} from ${sourcePath}\n`;
  let logTrouble: string | null = null;
  const note = Effect.fnUntraced(function* (text: string) {
    logged += text;
    const wrote = yield* Effect.result(files.writeFileString(log, logged));
    if (wrote._tag === 'Failure') logTrouble ??= `the log ${log} could not be written: ${wrote.failure.reason._tag}`;
  });
  const withTrouble = (detail: string): string => (logTrouble === null ? detail : `${detail}; ${logTrouble}`);
  const section = (step: string) => note(`\n=== ${step} ===\n`);
  const refuseEarly = (step: string, detail: string, unblock: readonly string[] = []) =>
    Effect.flatMap(note(`\n=== ${step} ===\n${[detail, ...unblock].join('\n')}\n`), () =>
      Effect.fail(new ReleaseRefused({ step, detail: withTrouble(detail), log, unblock })),
    );

  if (platform.os !== 'darwin') {
    return yield* refuseEarly(
      'platform',
      `a closure carries a desktop application and an execution host, and both are darwin's; this machine is ${platform.os}`,
    );
  }
  const app = client.root;
  const { desktop, checkout, packages } = roots;
  const captured = yield* capturedSource(checkout).pipe(
    Effect.catchTag('SourceRefused', (failure) => refuseEarly('revision', failure.message, failure.unblock)),
  );
  const host = `${packages}/execution-host`;
  if (release !== null) {
    const trouble = yield* targetTrouble(release.target, checkout);
    if (trouble !== null) return yield* refuseEarly('target', trouble.detail, trouble.unblock);
  }
  const platformPackages =
    release === null
      ? installedPackages
      : yield* lockedPackages(checkout, release.packages).pipe(Effect.catch((detail) => refuseEarly('checkout', detail)));
  const nativeModules = yield* nativeCarried(sourcePath, platformName, platformPackages).pipe(
    Effect.catch((detail) => refuseEarly('checkout', detail)),
  );
  const targeted = release === null ? null : release.target.arch;
  for (const [what, where] of [
    ['the CLI entry', entries.cli],
    ['the app package', `${app}/package.json`],
    ['the desktop package', `${desktop}/package.json`],
    ['the execution host', `${host}/package.json`],
  ] as const) {
    const there = yield* Effect.result(files.exists(where));
    if (there._tag === 'Failure') {
      return yield* refuseEarly('checkout', `${where} could not be read: ${there.failure.reason._tag}`);
    }
    if (!there.success) {
      return yield* refuseEarly('checkout', `${what} is not at ${where}; a release is cut from a checkout`);
    }
  }

  const now = new Date(yield* Clock.currentTimeMillis);
  const stamp = stamped(now);
  const staged: Claimed =
    release === null
      ? yield* staging(installRoot).pipe(
          Effect.catch((failure) =>
            refuseEarly('install root', failure._tag === 'InstallHeld' ? `${failure.path}: ${failure.reason}` : failure.detail),
          ),
        )
      : yield* Effect.sync(() => {
          const version = nextVersion(installRoot, now);
          return { version, root: openVersion(installRoot, version), release: () => undefined };
        });
  unswapped.root = staged.root;
  unswapped.release = staged.release;
  const root = staged.root;
  const at = (part: string) => `${root}/${part}`;
  yield* note(`${release === null ? 'staged in' : 'version'} ${staged.version}\n`);
  yield* said(`release ${stamp} from ${sourcePath}; every step's output goes to ${log}`);

  const refuse = Effect.fnUntraced(function* (step: string, detail: string, unblock: ReadonlyArray<string> = []) {
    const removed = yield* Effect.result(files.remove(root, { recursive: true, force: true }));
    const told =
      removed._tag === 'Success' ? detail : `${detail}; the half-written ${root} could not be removed: ${removed.failure.reason._tag}`;
    yield* note(`${[told, ...unblock].join('\n')}\n`);
    return yield* Effect.fail(new ReleaseRefused({ step, detail: withTrouble(told), log, unblock }));
  });

  const step = Effect.fnUntraced(function* <A, E>(
    name: string,
    work: Effect.Effect<A, E, FileSystem.FileSystem | Spawner>,
    failed: (error: E) => string | HostRefusal,
  ): Effect.fn.Return<A, ReleaseRefused, FileSystem.FileSystem | Spawner> {
    const started = yield* Clock.currentTimeMillis;
    yield* section(name);
    const outcome = yield* Effect.result(work);
    if (outcome._tag === 'Failure') {
      const told = failed(outcome.failure);
      return yield* typeof told === 'string' ? refuse(name, told) : refuse(name, told.detail, told.unblock);
    }
    yield* note(`landed in ${yield* took(started)}\n`);
    yield* said(`${name} landed in ${yield* took(started)}`);
    return outcome.success;
  });

  const handedRefusal = Effect.fnUntraced(function* (
    path: string,
    status: number,
  ): Effect.fn.Return<string | HostRefusal, never, FileSystem.FileSystem> {
    const broken = (why: string): HostRefusal => ({
      detail: `it exited ${status} and the refusal it left at ${path} cannot be taken: ${why}`,
      unblock: [`build again; if this repeats, the hand-off of refusals from the build is broken, and ${log} holds what it printed`],
    });
    const there = yield* Effect.result(files.exists(path));
    if (there._tag === 'Failure') return broken(there.failure.reason._tag);
    if (!there.success) return `it exited ${status}`;
    const text = yield* Effect.result(files.readFileString(path));
    if (text._tag === 'Failure') return broken(text.failure.reason._tag);
    const decoded = decodeRefusal(text.success);
    return decoded._tag === 'Success' ? decoded.success : broken(text.success.slice(0, 400));
  });

  const producer = (
    name: string,
    args: readonly string[],
    cwd: string,
    environment: Record<string, string>,
    proof: string,
    refusal: string | null = null,
  ): Effect.Effect<void, ReleaseRefused, FileSystem.FileSystem | Spawner> =>
    step(
      name,
      Effect.gen(function* () {
        const conditioned = { ...environment, [BUILD_CONDITIONS_ENV]: conditions.join(',') };
        const ran = yield* output(builder, args, cwd, refusal === null ? conditioned : { ...conditioned, [HOST_REFUSAL_ENV]: refusal });
        yield* note(ran.text);
        if (ran.status !== 0) {
          return yield* Effect.fail(refusal === null ? `it exited ${ran.status}` : yield* handedRefusal(refusal, ran.status));
        }
        const landed = yield* Effect.result(files.exists(proof));
        if (landed._tag === 'Failure') {
          return yield* Effect.fail(`whether it produced ${relativePath(root, proof)} could not be read: ${landed.failure.reason._tag}`);
        }
        if (!landed.success) return yield* Effect.fail(`it exited 0 and produced no ${relativePath(root, proof)}`);
      }),
      (error: string | HostRefusal | CommandUnavailable) => (typeof error === 'string' || !('_tag' in error) ? error : unrunnable(error)),
    );

  yield* step(
    'runtime',
    Effect.gen(function* () {
      const bytes = yield* files.readFile(runtime);
      yield* files.writeFile(at(RUNTIME_PART), bytes, { mode: 0o700 });
    }),
    (error) => `${runtime} could not be copied: ${String(error)}`,
  );

  const programs = yield* step(
    'program',
    Effect.scoped(
      Effect.gen(function* () {
        yield* files.makeDirectory(`${root}/bin/cli`, { recursive: true });
        yield* files.makeDirectory(`${root}/bin/server`, { recursive: true });
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            const stood = process.cwd();
            process.chdir(checkout);
            return stood;
          }),
          (stood) => Effect.sync(() => process.chdir(stood)),
        );
        const engine = yield* Effect.tryPromise({ try: () => buildEngine(targeted ?? undefined), catch: (cause) => String(cause) });
        const assets: Array<readonly [InstallationRole, string]> = [];
        for (const directory of [dirname(CLI_ENTRY), dirname(SERVER_ENTRY)]) {
          const carried = `${directory}/${engine.name}`;
          yield* files.copyFile(engine.path, at(carried));
          assets.push(['server', carried]);
        }
        const watching = yield* output(
          builder,
          [`${packages}/watch/src/artifact.ts`, ...(targeted === null ? [] : ['--arch', targeted])],
          `${packages}/watch`,
          {},
        );
        if (watching.status !== 0) return yield* Effect.fail(`the watch engine did not build: ${watching.text.trim()}`);
        const watchEngine = `${dirname(SERVER_ENTRY)}/${WATCH_ENGINE}`;
        yield* files.copyFile(watching.text.trim().split('\n').at(-1) ?? '', at(watchEngine));
        assets.push(['server', watchEngine]);
        const mapped = release === null ? null : { cut: release, root };
        const cli = yield* bundled(
          entries.cli,
          at(CLI_ENTRY),
          { from: importOf(entries.cli, entries.server), to: relativePath(dirname(`/${CLI_ENTRY}`), `/${SERVER_ENTRY}`) },
          composition,
          nativeModules.external,
          mapped,
        );
        const server = yield* bundled(entries.server, at(SERVER_ENTRY), null, composition, nativeModules.external, mapped);
        if (release !== null) {
          yield* files.makeDirectory(release.inputs, { recursive: true });
          const skills = yield* skillInputs(sourcePath);
          const inputs = [...new Set([...cli.inputs, ...server.inputs, ...skills])].sort();
          yield* files.writeFileString(`${release.inputs}/${PROGRAM_INPUTS}`, JSON.stringify(inputs));
        }
        return [
          ...assets,
          ...cli.written.map((path): readonly [InstallationRole, string] => ['cli', relativePath(root, path)]),
          ...server.written.map((path): readonly [InstallationRole, string] => ['server', relativePath(root, path)]),
        ];
      }),
    ),
    (error) => String(error),
  );

  yield* step(
    'package',
    Effect.gen(function* () {
      yield* files.copy(`${sourcePath}/${MIGRATIONS}`, at(MIGRATIONS));
      yield* carrySkills(sourcePath, root);
      yield* writeInstallationPackage(`${sourcePath}/${PACKAGE_FILE}`, at(PACKAGE_FILE));
      yield* files.copy(`${packages}/performance/${MIGRATIONS}`, at(EVIDENCE_MIGRATIONS));
      yield* files.copy(`${packages}/activity/${MIGRATIONS}`, at(ACTIVITY_MIGRATIONS));
      for (const store of composition.stores) yield* files.copy(store.migrations, at(`${STORE_MIGRATIONS}/${store.id}`));
      yield* carryNative(nativeModules, root);
      const asked = nativeModules.loaded;
      const probed = yield* output(runtime, ['-e', `for (const name of ${JSON.stringify(asked)}) require(name);`], at('bin/server'), {});
      yield* note(`${asked.join('\n')}\n${probed.text}`);
      if (probed.status !== 0) {
        return yield* Effect.fail(`a compiled module it carries does not load: ${probed.text.trim()}`);
      }
    }),
    (error) =>
      typeof error === 'string'
        ? error
        : error._tag === 'CommandUnavailable'
          ? unrunnable(error)
          : `the package files could not be copied: ${String(error)}`,
  );

  for (const [name, carry] of [
    ['tools', carryRipgrep],
    ['typescript', carryTypescript],
  ] as const)
    yield* step(name, Effect.flatMap(carry({ packages, root, platform: platformName, carried: platformPackages }), note), (error) =>
      typeof error === 'string'
        ? error
        : error._tag === 'CommandUnavailable'
          ? unrunnable(error)
          : `the ${name} step could not carry its tool: ${String(error)}`,
    );

  yield* Effect.scoped(
    Effect.gen(function* () {
      const directory = `${app}/.svelte-kit`;
      yield* files.makeDirectory(directory, { recursive: true });
      const work = yield* files.makeTempDirectoryScoped({ directory, prefix: 'cut-' });
      yield* producer(
        'surface',
        ['run', 'build', ...(client.config === null ? [] : ['--config', client.config])],
        app,
        { TAGMA_SURFACE_OUT: at(SURFACE), TAGMA_SURFACE_WORK: realpathSync(work), ...producedBy(release, SURFACE) },
        at(`${SURFACE}/${SURFACE_INDEX}`),
      );
    }).pipe(
      Effect.catchTag('PlatformError', (error) => refuse('surface', `its build directory could not be opened: ${error.reason._tag}`)),
    ),
  );
  const engine = yield* step(
    'speech engine',
    Effect.tap(carriedEngine(builder, packages, root, targeted), (outcome) =>
      note(outcome._tag === 'carried' ? outcome.log : `the Whisper engine is absent from this closure: ${outcome.reason}\n`),
    ),
    (error) => (typeof error === 'string' ? error : unrunnable(error)),
  );
  if (release !== null && engine._tag === 'absent') {
    return yield* refuse('speech engine', `a release carries the Whisper engine, and it was not built: ${engine.reason}`, [
      'install cmake and the Xcode command line tools on this Mac, then cut the release again',
    ]);
  }

  const labels = yield* step('revision', labelled(git, checkout, release === null ? stamp : staged.version, captured), troubleOf);
  const build = release === null ? labels.build : release.number;
  const { tree } = labels;
  yield* step(
    'executions',
    Effect.gen(function* () {
      const mapOrigin = sourceMapOriginIn(process.env);
      const released =
        release === null
          ? []
          : [
              ...(mapOrigin === undefined ? [] : ['--origin-from', mapOrigin.from, '--origin-to', mapOrigin.to]),
              '--inputs',
              `${release.inputs}/${EXECUTIONS_INPUTS}`,
              '--maps',
              `${release.maps}/${EXECUTIONS}`,
              '--sign',
              release.signer.fingerprint,
              '--arch',
              release.target.arch,
              '--runtime',
              runtime,
              '--bare',
            ];
      const args = [`${host}/src/buildArtifact.ts`, at(EXECUTIONS), build, '--conditions', conditions.join(','), ...released];
      const ran = yield* output(builder, args, host, {});
      yield* note(ran.text);
      const answered = ran.text.trim().split('\n').at(-1);
      if (ran.status !== 0) return yield* Effect.fail(answered ? `it exited ${ran.status}: ${answered}` : `it exited ${ran.status}`);
      yield* verifyArtifact(at(EXECUTIONS)).pipe(
        Effect.catch((refusal) => Effect.fail(`the bundle it wrote does not verify: ${refusal._tag}`)),
      );
    }),
    (error: string | CommandUnavailable) => (typeof error === 'string' ? error : unrunnable(error)),
  );

  if (release !== null) {
    yield* step('sealing', sealRelease(root, release.signer.fingerprint, [RUNTIME_PART, EXECUTIONS, DESKTOP]), (error: string) => error);
  }

  const manifest = yield* step(
    'manifest',
    Effect.gen(function* () {
      const stores = composition.stores.length === 0 ? [] : [['migrations', STORE_MIGRATIONS] as const];
      const layout = [...programs, ...CLOSURE_LAYOUT, ...stores, ...engineLayout(engine)];
      const measured = yield* Effect.forEach(layout, ([role, place]) => partsAt(root, role, place));
      const carried: InstallationProvenance | undefined = origin === undefined ? { checkout } : origin === null ? undefined : origin;
      const source = carried === undefined ? undefined : { ...carried, inputs: captured?.inputs ?? carried.inputs };
      return yield* writeInstallation(root, platform, build, measured.flat(), source, tree, release?.irreversible);
    }),
    (refusal) => `${refusal.path}: ${refusal.detail}`,
  );

  yield* section('signing');
  const signing = yield* Effect.result(release === null ? signingIdentity : Effect.succeed(release.signer));
  if (signing._tag === 'Failure') return yield* refuse('signing', signing.failure.detail, signing.failure.unblock);
  const signer = signing.success;
  yield* note(`${signingNotice(signer)}\n`);
  yield* said(signingNotice(signer));
  yield* producer(
    'desktop',
    [...conditions.map((condition) => `--conditions=${condition}`), `${desktop}/scripts/build-host.ts`],
    desktop,
    {
      TAGMA_HOST_OUT: at(DESKTOP),
      TAGMA_HOST_RELEASE: root,
      [HOST_CHANNEL_ENV]: JSON.stringify(composition.channel),
      [HOST_ASSETS_ENV]: composition.brand.assets,
      [SIGNING_IDENTITY_ENV]: signer.fingerprint,
      ...producedBy(release, DESKTOP),
    },
    at(`${DESKTOP}/${hostBinary(composition.channel.name)}`),
    at(HOST_REFUSAL_FILE),
  );

  const landing = yield* step(
    release === null ? 'swap' : 'staged',
    release !== null
      ? Effect.map(writing(platform), (launcher) => ({ launcher, version: staged.version, previous: null, left: null }))
      : moving(installRoot, (lock) =>
          Effect.gen(function* () {
            const move = yield* moveFrom(lock);
            const launcher = yield* writing(platform);
            const version = yield* published(lock, staged);
            unswapped.root = null;
            const left = yield* madeCurrent(lock, version, move, false, composition.applications.forget);
            unswapped.swapped(version);
            return { launcher, version, previous: move.from === version ? null : move.from, left };
          }),
        ),
    landingRefusal,
  );
  if (landing.left !== null) yield* note(`${landing.left}\n`);
  yield* said(`${release === null ? 'installed' : 'cut release'} ${build}${logTrouble === null ? '' : ` — ${logTrouble}`}`);
  return {
    version: landing.version,
    root: `${installRoot}/${landing.version}`,
    manifest,
    launcher: landing.launcher,
    log,
    previous: landing.previous,
  };
});

const landingRefusal = (
  error: LauncherWriteFailed | InstallHeld | AttemptStanding | RecordUnreadable | MoveFailed,
): string | HostRefusal => {
  switch (error._tag) {
    case 'LauncherWriteFailed':
      return `${error.path}: ${error.detail}`;
    case 'InstallHeld':
      return `${error.path} could not be held: ${error.reason}`;
    case 'MoveFailed':
      return `${error.step}: ${error.detail}`;
    case 'AttemptStanding':
      return {
        detail: `the update onto ${error.attempt.to} stands open, so no other installation becomes current before it ends`,
        unblock: ['start the server of current: it finishes the update or rolls it back', 'then build again'],
      };
    case 'RecordUnreadable':
      return {
        detail: `${error.message}, so no other installation becomes current before it is set aside`,
        unblock: ['start the server of current: its start sets the record aside with the data copies it may name', 'then build again'],
      };
  }
};

export const releaseInstallation = (
  installRoot: string,
  launcher: string,
  env: NodeJS.ProcessEnv,
  composition: Composition,
  origin: InstallationProvenance | null | undefined = undefined,
  swapped: (version: string) => void = () => undefined,
): Effect.Effect<ReleaseLanded, ReleaseRefused, FileSystem.FileSystem | Spawner | Git> =>
  releaseWith(installRoot, composition, (platform) => writeLauncher(installRoot, launcher, platform, env), origin, swapped);

export const releaseBeside = (
  installRoot: string,
  launcher: string,
  composition: Composition,
  env: Readonly<Record<string, string>> = {},
): Effect.Effect<ReleaseLanded<string>, ReleaseRefused, FileSystem.FileSystem | Spawner | Git> =>
  releaseWith(installRoot, composition, (platform) => writeLauncherBeside(installRoot, launcher, platform, env));

export const releaseStaged = (
  stage: string,
  composition: Composition,
  release: ReleaseCut,
): Effect.Effect<ReleaseLanded<null>, ReleaseRefused, FileSystem.FileSystem | Spawner | Git> =>
  releaseWith(
    stage,
    composition,
    () => Effect.succeed(null),
    null,
    () => undefined,
    release,
  );
