import { appendFileSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect, FileSystem, Layer, type PlatformError, Schema, type Scope } from 'effect';
import type { ChildProcessSpawner } from 'effect/process';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Git, gitLayer } from '@runlith/git/Git';
import { troubleOf } from '@runlith/git/repository';
import { developerLabels } from '@runlith/tagma/adapter/host-modules';
import { gitCut, gitTree } from '../../platform/git/readings.js';
import { baselineReceipt } from '../../platform/store/baseline.js';
import { refusalLines } from '@runlith/agent/tool/refusal';
import { EXECUTIONS_RUNTIME } from '../contract/wire/archive.js';
import { archivesOf, compareReleases, isRelease, LEGACY_PLATFORM, releaseAfter, type StoreMarks } from '../contract/wire/feed.js';
import type { Channel } from '../contract/wire/channel.js';
import { dataDirectory, hostBundle, RELEASE_INSIDE } from '../contract/wire/layout.js';
import { diskImage } from './dmg.js';
import { DESKTOP, IRREVERSIBLE_STORES, type IrreversibleChange, MIGRATIONS } from '../contract/wire/manifest.js';
import { releaseIdentity } from '../setup/signing.js';
import { output } from './command.js';
import { archiveTrouble, developerInputs, type Label, sourceComments } from './proof.js';
import { FEED_REPOSITORY, feedRemote, publishedClone } from './published.js';
import { type Composition, INPUT_RECORDS, RELEASE_LOG, ReleaseRefused, releaseStaged } from './release.js';
import { releaseRuntime } from './runtime.js';
import { type Built, type BuiltPlatform, INPUTS, MAPS, type Released, stagedCut, type Stages, type Trying } from './stage.js';
import { type Target, TARGETS, targetName } from './target.js';
import { trialStart } from './trial.js';

export const RELEASE_DIRECTORY = 'release';
export const KEPT_MAPS = 'maps';
export const diskImageFile = (channel: Channel, release: string, target: Target): string => `${channel.name}-${release}-${target.arch}.dmg`;
export const desktopAssets = (sourcePath: string): string => resolve(sourcePath, '..', 'desktop', 'assets');
export const checkoutOf = (sourcePath: string): string => resolve(sourcePath, '..', '..', '..');
export type CutCache = { readonly runtimes: string; readonly packages: string };
export const cutCache = (data: string): CutCache => ({
  runtimes: join(data, 'cut-cache', 'runtimes'),
  packages: join(data, 'cut-cache', 'packages'),
});

const PACK_FLAGS = ['--no-xattrs', '--no-mac-metadata', '--no-acls', '--no-fflags', '--uid', '0', '--gid', '0', '--numeric-owner'];
const MIGRATION = /^\d{14}_/u;
const TOLD = 10;

export type Steps = {
  readonly graph: readonly string[];
  readonly journal: readonly string[];
};

export type Previous = { readonly stores: StoreMarks; readonly changes: readonly IrreversibleChange[] };

const decodeInputs = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Array(Schema.String)));

export const irreversibleOf = (release: string, stores: StoreMarks, previous: Previous | null): readonly IrreversibleChange[] =>
  previous === null
    ? []
    : [
        ...previous.changes,
        ...IRREVERSIBLE_STORES.filter((store) => stores[store].some((name) => !previous.stores[store].includes(name))).map((store) => ({
          store,
          release,
        })),
      ];

export const unfoldedOf = (stores: StoreMarks, carried: StoreMarks, baseline: string | null): readonly string[] => {
  const published = new Set(carried['machine-store']);
  return stores['machine-store'].filter((name) => name !== baseline && published.has(name));
};

type Machine = FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner | Git;

const within = (path: string, root: string): boolean => path === root || path.startsWith(`${root}/`);

export const machinePaths = (checkout: string, out: string): readonly string[] => {
  const scratch = tmpdir().replace(/\/$/u, '');
  const real = realpathSync(scratch);
  const spelled = [homedir(), checkout, out, scratch, real, real.replace(/^\/private\//u, '/')];
  return [...new Set(spelled)].filter((path, _, all) => !all.some((other) => other !== path && within(path, other)));
};

export const packRelease = (
  root: string,
  archive: string,
  entry = '.',
): Effect.Effect<void, string, ChildProcessSpawner.ChildProcessSpawner> =>
  output('/usr/bin/tar', [...PACK_FLAGS, '--exclude', `./${EXECUTIONS_RUNTIME}`, '-czf', archive, '-C', root, entry], root, {
    COPYFILE_DISABLE: '1',
  }).pipe(
    Effect.mapError((failure) => failure.detail),
    Effect.flatMap((ran) => (ran.status === 0 ? Effect.void : Effect.fail(`tar exited ${ran.status}: ${ran.text.trim()}`))),
  );

export const storesOf = Effect.fnUntraced(function* (sourcePath: string, steps: Steps) {
  const files = yield* FileSystem.FileSystem;
  const migrations = (dir: string) =>
    files.readDirectory(dir).pipe(
      Effect.map((entries) => entries.filter((entry) => MIGRATION.test(entry)).sort()),
      Effect.mapError(
        (error) => new ReleaseRefused({ step: 'release', detail: `${dir} could not be read: ${error.reason._tag}`, log: '', unblock: [] }),
      ),
    );
  const stores: StoreMarks = {
    'machine-store': yield* migrations(join(sourcePath, MIGRATIONS)),
    'host-store': yield* migrations(join(checkoutOf(sourcePath), 'packages', 'execution-host', MIGRATIONS)),
    graph: steps.graph,
    journal: steps.journal,
  };
  return stores;
});

export type Cut = {
  readonly composition: Composition;
  readonly asked: string | null;
  readonly out: string;
  readonly cache: CutCache;
  readonly steps: Steps;
  readonly remote: string;
};

export const cutRelease = Effect.fn('installation.cutRelease')(function* (
  sourcePath: string,
  { composition, asked, out, cache, steps, remote }: Cut,
): Effect.fn.Return<Released, ReleaseRefused, Machine | Scope.Scope> {
  const files = yield* FileSystem.FileSystem;
  const git = yield* Git;
  const context = yield* Effect.context<Machine>();
  const checkout = checkoutOf(sourcePath);
  let logged = '';
  const refusal = (step: string, detail: string, unblock: readonly string[] = []) =>
    new ReleaseRefused({ step, detail, log: logged, unblock: [...unblock] });
  const refuse = (step: string, detail: string, unblock: readonly string[] = []) => Effect.fail(refusal(step, detail, unblock));
  const unreadable = (what: string) => (error: PlatformError.PlatformError) =>
    new ReleaseRefused({ step: 'release', detail: `${what} could not be read: ${error.reason._tag}`, log: '', unblock: [] });

  if (asked !== null && !isRelease(asked)) {
    return yield* refuse('version', `${asked} is no version: one to three whole numbers joined by dots`, [USAGE]);
  }
  const [cut, tree] = yield* Effect.all([gitCut(git, checkout), gitTree(git, checkout)]).pipe(
    Effect.mapError((failure) => refusal('tree', troubleOf(failure))),
  );
  if (cut === null || tree.changed > 0) {
    return yield* refuse(
      'tree',
      `${checkout} ${cut === null ? 'has no commit' : `has ${tree.changed} uncommitted or untracked paths`}, and a release is cut from a commit, so the same commit cuts it again`,
      ['commit the changes, then bun run tagma:release'],
    );
  }

  const published = yield* publishedClone(remote).pipe(
    Effect.mapError((trouble) =>
      refusal('feed', `what ${remote} publishes could not be read: ${trouble.detail}`, [
        'the version and what is irreversible are judged against the newest published release: reach GitHub, then bun run tagma:release',
      ]),
    ),
  );
  const newest = published.feed === null ? null : published.feed.releases.toSorted((a, b) => compareReleases(b.release, a.release))[0]!;
  if (asked !== null && newest !== null && compareReleases(asked, newest.release) <= 0) {
    return yield* refuse('version', `${newest.release} is published, and each version is newer than every one before it`, [
      `bun run tagma:release --version <a version after ${newest.release}>`,
      'bun run tagma:release — takes the next one',
    ]);
  }
  const release = asked ?? releaseAfter(newest?.release ?? null);

  const runtimes = yield* Effect.forEach(TARGETS, (target) =>
    releaseRuntime(checkout, Bun.version, target, cache.runtimes).pipe(
      Effect.map((runtime) => ({ target, runtime })),
      Effect.mapError((trouble) => refusal('runtime', trouble.detail, trouble.unblock)),
    ),
  );
  const signer = yield* releaseIdentity.pipe(Effect.mapError((failure) => refusal('signing', failure.detail, failure.unblock)));

  const stores = yield* storesOf(sourcePath, steps);
  if (newest !== null) {
    const receipt = yield* baselineReceipt(join(sourcePath, MIGRATIONS)).pipe(
      Effect.mapError((failure) => refusal('fold', failure.message)),
    );
    const unfolded = unfoldedOf(stores, newest.stores, receipt?.migration ?? null);
    if (unfolded.length > 0) {
      const last = unfolded.at(-1)!;
      return yield* refuse(
        'fold',
        `${newest.release} already carries ${unfolded.length} machine-store migrations that still stand beyond the baseline: ${unfolded.join(', ')}`,
        [
          `fold the machine-store migrations through ${last} into a new baseline (apps/tagma/server/scripts/baseline.ts with release ${newest.release} and cut ${last}, then its install)`,
          'then commit the fold and bun run tagma:release',
        ],
      );
    }
  }
  const irreversible = irreversibleOf(release, stores, newest === null ? null : { stores: newest.stores, changes: newest.changes });

  const manifests = [
    ...(yield* files.readDirectory(join(checkout, 'packages')).pipe(Effect.mapError(unreadable(join(checkout, 'packages'))))).map((name) =>
      join(checkout, 'packages', name, 'package.json'),
    ),
    ...(yield* files.readDirectory(join(sourcePath, 'src')).pipe(Effect.mapError(unreadable(join(sourcePath, 'src'))))).map((name) =>
      join(sourcePath, 'src', name, 'module.json'),
    ),
  ];
  const declared = yield* Effect.tryPromise({
    try: () => developerLabels(manifests),
    catch: (error) => refusal('labels', `the labels developer packages declare could not be read: ${String(error)}`),
  });
  const labels: Label[] = declared.flatMap((one) => one.labels.map((text) => ({ text, by: relative(checkout, one.manifest) })));

  const application = hostBundle(composition.channel.name);

  const built = Effect.fnUntraced(function* (home: string, target: Target, runtime: string) {
    const inputs = join(home, INPUTS);
    const landed = yield* releaseStaged(sourcePath, home, composition, {
      number: release,
      signer,
      maps: join(home, MAPS),
      inputs,
      irreversible,
      target,
      runtime,
      packages: cache.packages,
    });
    const archive = join(home, `tagma-${release}-${targetName(target)}.tar.gz`);
    const image = join(home, diskImageFile(composition.channel, release, target));

    const comments = yield* Effect.gen(function* () {
      const recorded: string[] = [];
      for (const producer of INPUT_RECORDS) {
        const path = join(inputs, producer);
        const unrecorded = `${path} records no inputs of the build that produced it, so what the release carries is unproved`;
        const text = yield* files.readFileString(path).pipe(Effect.mapError(() => refusal('composition', unrecorded)));
        const decoded = decodeInputs(text);
        if (decoded._tag === 'Failure' || decoded.success.length === 0) return yield* refuse('composition', unrecorded);
        recorded.push(...decoded.success);
      }
      const developers = yield* developerInputs(recorded);
      if (developers.length > 0) {
        const told = developers.slice(0, TOLD).map((one) => `${relative(checkout, one.input)} (${relative(checkout, one.manifest)})`);
        return yield* refuse(
          'composition',
          `the release carries ${developers.length} sources of developer packages and modules: ${told.join(', ')}`,
          ['remove the import that reaches them from the release composition, then cut the release again'],
        );
      }
      const kept = yield* sourceComments(recorded, checkout).pipe(Effect.mapError((failure) => refusal('comments', failure)));
      yield* packRelease(join(landed.root, DESKTOP), archive, application).pipe(Effect.mapError((failure) => refusal('pack', failure)));
      yield* diskImage(join(landed.root, DESKTOP, application), image, desktopAssets(sourcePath), composition.channel.name, {
        identity: signer.fingerprint,
        timestamp: true,
      }).pipe(Effect.mapError((failure) => refusal('disk image', failure)));
      return kept;
    }).pipe(Effect.ensuring(Effect.sync(() => rmSync(landed.root, { recursive: true, force: true }))));

    const trouble = yield* archiveTrouble(archive, {
      labels,
      paths: machinePaths(checkout, out),
      comments,
      root: `${application}/${RELEASE_INSIDE}`,
    });
    if (trouble.length > 0) {
      return yield* refuse('proof', `the archive is refused: ${trouble.join('; ')}`, [`${archive} — the refused archive, kept to be read`]);
    }
    return { archive, image };
  });

  const build = Effect.fnUntraced(function* (home: string): Effect.fn.Return<Built, ReleaseRefused, Machine> {
    logged = join(home, RELEASE_LOG);
    const platforms: Record<string, BuiltPlatform> = {};
    for (const { target, runtime } of runtimes) platforms[targetName(target)] = yield* built(home, target, runtime);
    return { platforms };
  });

  const tried = (trying: Trying, target: Target): Effect.Effect<void, ReleaseRefused> => {
    const name = targetName(target);
    const offered = archivesOf(trying.offer)[name];
    if (offered === undefined) {
      return refuse('trial', `the release offers no ${name} archive to try`, [`${trying.log} — the cut it built`]);
    }
    return trialStart({
      channel: composition.channel,
      archive: fileURLToPath(offered.archive),
      offer: trying.offer,
      predecessor: name === LEGACY_PLATFORM ? trying.predecessor : null,
      labels,
      scratch: tmpdir(),
      log: (line) => appendFileSync(trying.log, `\n=== trial ${name} ===\n${line}\n`),
    }).pipe(
      Effect.flatMap((trouble) =>
        trouble === null
          ? Effect.void
          : Effect.fail(
              new ReleaseRefused({
                step: 'trial',
                detail: `the ${name} release installed and started in a world of its own refuses: ${trouble}`,
                log: trying.log,
                unblock: [`${trying.log} — what the trial printed; bun run tagma:release again takes up the cut it built`],
              }),
            ),
      ),
    );
  };

  const stages: Stages = {
    build: (home) => build(home).pipe(Effect.provideContext(context)),
    trial: (trying) => Effect.forEach(TARGETS, (target) => tried(trying, target), { discard: true }),
  };
  return yield* stagedCut(out, { release, commit: cut.head, stores, irreversible }, stages);
}, Effect.scoped);

const USAGE = 'bun run tagma:release [--version <x.y.z>] [--repo <owner/name>] [--out <dir>] [--notarize] [--json]';
const REPOSITORY = /^[\w.-]+\/[\w.-]+$/u;

const spawning = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));

export type Flags = { readonly json: boolean; readonly value: (name: string) => string | undefined; readonly rest: readonly string[] };

export const flagsOf = (given: readonly string[], told: (code: string, reason: string) => never): Flags => {
  const args = [...given];
  const json = args.includes('--json');
  const values = new Map<string, string>();
  for (let at = 0; at < args.length; at += 1) {
    const one = args[at]!;
    if (!one.startsWith('--') || one === '--json') continue;
    const value = args[at + 1];
    if (value === undefined || value.startsWith('--')) told('no-value', `${one} names no value`);
    values.set(one, value!);
    args.splice(at, 2);
    at -= 1;
  }
  return { json, value: (name) => values.get(name), rest: args.filter((one) => one !== '--json') };
};

export const releaseCommand = Effect.fnUntraced(function* (
  sourcePath: string,
  given: readonly string[],
  composition: Composition,
  steps: Steps,
  developer: Channel,
) {
  let json = given.includes('--json');
  const told = (code: string, reason: string, unblock: readonly string[] = [USAGE]): never => {
    if (json) console.log(JSON.stringify({ code, reason, unblock }));
    else console.error(refusalLines({ code, reason, unblock: [...unblock] }).join('\n'));
    process.exit(2);
  };
  const flags = flagsOf(given, told);
  json = flags.json;
  if (flags.rest.length > 0) told('usage', `${flags.rest.join(' ')} is not understood`);
  const repo = flags.value('--repo') ?? FEED_REPOSITORY;
  if (!REPOSITORY.test(repo)) told('usage', `${repo} names no GitHub repository: owner/name`);
  const data = dataDirectory(developer, process.env);
  if (data === null) return told('no-home', 'HOME names no home directory, so where the release is cut is unknown');
  const named = flags.value('--out');
  const out = named === undefined ? join(data, RELEASE_DIRECTORY) : resolve(named);
  const cut = yield* Effect.result(
    cutRelease(sourcePath, {
      composition,
      asked: flags.value('--version') ?? null,
      out,
      cache: cutCache(data),
      steps,
      remote: feedRemote(repo),
    }).pipe(Effect.provide(Layer.mergeAll(gitLayer.pipe(Layer.provide(spawning)), spawning, BunFileSystem.layer))),
  );
  if (cut._tag === 'Failure') {
    return told('release-refused', `${cut.failure.step}: ${cut.failure.detail}`, [
      ...cut.failure.unblock,
      ...(cut.failure.log === '' ? [] : [`${cut.failure.log} — the whole output of every step of this release`]),
    ]);
  }
  const { record, images, feed, maps, inputs, log } = cut.success;
  const home = dirname(feed);
  const own = record.irreversible.filter((change) => change.release === record.release).map((change) => change.store);
  if (json) {
    console.log(JSON.stringify({ ...record, images, feed, maps, inputs, log }, null, 2));
    return;
  }
  for (const line of [
    `${composition.channel.name} ${record.release} of ${record.commit} — ${out}`,
    ...Object.entries(record.platforms).flatMap(([platform, one]) => [
      `application ${platform} ${images[platform] ?? 'missing'}`,
      `update archive ${platform} ${join(home, one.archive)}, ${(one.size / 1024 / 1024).toFixed(1)} MB, sha256 ${one.sha256}`,
    ]),
    own.length === 0
      ? 'the published release before it reads everything it writes'
      : `irreversible for the published release before it: ${own.join(', ')}`,
    `a feed of this release alone, to try an update on this machine: ${feed}`,
    `source maps ${maps}: publishing keeps them under ${join(data, KEPT_MAPS, record.release)}`,
    `log ${log}`,
    `bun run tagma:release publish — publishes ${record.release} in ${repo}`,
  ])
    console.log(line);
});
