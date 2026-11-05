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
import { gitCut, gitTree } from '../platform/git/readings.js';
import { refusalLines } from '@runlith/agent/tool/refusal';
import { compareReleases, isRelease, newestOf, releaseAfter, type StoreMarks } from '../installation/contract/wire/feed.js';
import { dataDirectory } from '../installation/contract/wire/layout.js';
import { DESKTOP, IRREVERSIBLE_STORES, type IrreversibleChange, MIGRATIONS } from '../installation/contract/wire/manifest.js';
import type { Composition, Publisher, SourceRoots } from './descriptor.js';
import { archiveTrouble, developerInputs, type Label, sourceComments } from './proof.js';
import { checkoutTags, highestOf, precedingOf } from './published.js';
import { BACK_SCRIPT } from '@runlith/sqlite-process/chainReturn';
import { ASIDE_FILE, type StepBackLoss, stepBackLosses } from '../platform/store/migrationLaw.js';
import { INPUT_RECORDS, RELEASE_LOG, ReleaseRefused, releaseStaged } from './release.js';
import { releaseRuntime } from './runtime.js';
import { BRAND, type Built, type BuiltPlatform, INPUTS, MAPS, type Released, stagedCut, type Stages, type Trying } from './stage.js';
import { type Target, targetName } from './target.js';

export const RELEASE_DIRECTORY = 'release';
export const KEPT_MAPS = 'maps';
export type CutCache = { readonly runtimes: string; readonly packages: string };
export const cutCache = (data: string): CutCache => ({
  runtimes: join(data, 'cut-cache', 'runtimes'),
  packages: join(data, 'cut-cache', 'packages'),
});

const MIGRATION = /^\d{14}_/u;
const TOLD = 10;

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

const droppedOf = (stores: StoreMarks, carried: StoreMarks): readonly string[] =>
  IRREVERSIBLE_STORES.flatMap((store) => carried[store].filter((name) => !stores[store].includes(name)).map((name) => `${store} ${name}`));

type Machine = FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner | Git;

const within = (path: string, root: string): boolean => path === root || path.startsWith(`${root}/`);

export const machinePaths = (checkout: string, out: string): readonly string[] => {
  const scratch = tmpdir().replace(/\/$/u, '');
  const real = realpathSync(scratch);
  const spelled = [homedir(), checkout, out, scratch, real, real.replace(/^\/private\//u, '/')];
  return [...new Set(spelled)].filter((path, _, all) => !all.some((other) => other !== path && within(path, other)));
};

export const storesOf = Effect.fnUntraced(function* ({ roots, steps }: Composition) {
  const files = yield* FileSystem.FileSystem;
  const migrations = (dir: string) =>
    files.readDirectory(dir).pipe(
      Effect.map((entries) => entries.filter((entry) => MIGRATION.test(entry)).sort()),
      Effect.mapError(
        (error) => new ReleaseRefused({ step: 'release', detail: `${dir} could not be read: ${error.reason._tag}`, log: '', unblock: [] }),
      ),
    );
  const stores: StoreMarks = {
    'machine-store': yield* migrations(join(roots.server, MIGRATIONS)),
    'host-store': yield* migrations(join(roots.packages, 'execution-host', MIGRATIONS)),
    graph: steps.graph,
    journal: steps.journal,
  };
  return stores;
});

const CHAINS = [
  ['machine-store', (roots: SourceRoots) => join(roots.server, MIGRATIONS)],
  ['host-store', (roots: SourceRoots) => join(roots.packages, 'execution-host', MIGRATIONS)],
] as const;

const lossesPast = Effect.fnUntraced(function* (roots: SourceRoots, stores: StoreMarks, boundary: StoreMarks) {
  const files = yield* FileSystem.FileSystem;
  const beside = (path: string) =>
    Effect.flatMap(files.exists(path), (there) =>
      there ? Effect.map(files.readFileString(path), (text): string | null => text) : Effect.succeed(null),
    );
  const losses: StepBackLoss[] = [];
  for (const [store, folderOf] of CHAINS) {
    const folder = folderOf(roots);
    const judged = new Set(stores[store].filter((name) => !boundary[store].includes(name)));
    if (judged.size === 0) continue;
    const chain = yield* Effect.forEach(stores[store], (name) =>
      Effect.all({
        name: Effect.succeed(name),
        sql: files.readFileString(join(folder, name, 'migration.sql')),
        back: beside(join(folder, name, BACK_SCRIPT)),
        aside: beside(join(folder, name, ASIDE_FILE)),
      }),
    );
    losses.push(...stepBackLosses(chain, judged));
  }
  return losses;
});

export type Cut = {
  readonly composition: Composition;
  readonly asked: string | null;
  readonly out: string;
  readonly cache: CutCache;
};

export const publishedBy = (publisher: Publisher | null) => (publisher === null ? Effect.succeed(null) : Effect.scoped(publisher.latest));

export const cutRelease = Effect.fn('installation.cutRelease')(function* ({
  composition,
  asked,
  out,
  cache,
}: Cut): Effect.fn.Return<Released, ReleaseRefused, Machine | Scope.Scope> {
  const files = yield* FileSystem.FileSystem;
  const git = yield* Git;
  const context = yield* Effect.context<Machine>();
  const { checkout, packages, server } = composition.roots;
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

  const { publisher } = composition;
  const latest = yield* publishedBy(publisher).pipe(
    Effect.mapError((trouble) =>
      refusal('feed', `what ${publisher?.place} publishes could not be read: ${trouble.detail}`, [
        ...trouble.unblock,
        `the version and what is irreversible are judged against the newest published release: reach ${publisher?.place}, then bun run tagma:release`,
      ]),
    ),
  );
  const tags = yield* checkoutTags(checkout).pipe(Effect.mapError((trouble) => refusal('tree', trouble.detail)));
  const highest = highestOf(latest, tags);
  const newest = latest === null ? null : newestOf(latest);
  if (asked !== null && highest !== null && compareReleases(asked, highest) <= 0) {
    return yield* refuse('version', `${highest} is published, and each version is newer than every one before it`, [
      `bun run tagma:release --version <a version after ${highest}>`,
      'bun run tagma:release — takes the next one',
    ]);
  }
  const release = asked ?? releaseAfter(highest);

  const stores = yield* storesOf(composition);
  const dropped = newest === null ? [] : droppedOf(stores, newest.stores);
  if (newest !== null && dropped.length > 0) {
    return yield* refuse(
      'stores',
      `${newest.release} is published with ${dropped.length} migrations and steps this cut lacks: ${dropped.slice(0, TOLD).join(', ')}`,
      [`bring them back: a store ${newest.release} wrote reaches the newest form only through every migration and step it ran`],
    );
  }
  if (newest !== null) {
    const preceding = precedingOf(latest, tags, newest.release);
    const boundary = latest?.releases.find((one) => one.release === preceding) ?? newest;
    const losses = yield* lossesPast(composition.roots, stores, boundary.stores).pipe(
      Effect.mapError((error) => refusal('backs', `the migrations this cut carries could not be read: ${error.reason._tag}`)),
    );
    if (losses.length > 0)
      return yield* refuse(
        'backs',
        `a step back from ${release} to ${boundary.release} would lose what ${losses.length} of its migrations change: ${losses
          .slice(0, TOLD)
          .map((loss) => `${loss.migration}: ${loss.message}`)
          .join('; ')}`,
        [`add the back.sql or aside.json each names beside its migration, then bun run tagma:release`],
      );
  }
  const irreversible = irreversibleOf(release, stores, newest === null ? null : { stores: newest.stores, changes: newest.changes });

  const { platform } = composition;
  const runtimes = yield* Effect.forEach(platform.targets, (target) =>
    releaseRuntime(checkout, Bun.version, platform.runtime(target), cache.runtimes).pipe(
      Effect.map((runtime) => ({ target, runtime })),
      Effect.mapError((trouble) => refusal('runtime', trouble.detail, trouble.unblock)),
    ),
  );
  const signer = yield* platform
    .releaseSigner(composition.signing.team)
    .pipe(Effect.mapError((failure) => refusal('signing', failure.detail, failure.unblock)));

  const manifests = [
    ...(yield* files.readDirectory(packages).pipe(Effect.mapError(unreadable(packages)))).map((name) =>
      join(packages, name, 'package.json'),
    ),
    ...(yield* files.readDirectory(join(server, 'src')).pipe(Effect.mapError(unreadable(join(server, 'src'))))).map((name) =>
      join(server, 'src', name, 'module.json'),
    ),
  ];
  const declared = yield* Effect.tryPromise({
    try: () => developerLabels(manifests),
    catch: (error) => refusal('labels', `the labels developer packages declare could not be read: ${String(error)}`),
  });
  const labels: Label[] = declared.flatMap((one) => one.labels.map((text) => ({ text, by: relative(checkout, one.manifest) })));

  const application = platform.application(composition.channel.name).bundle;

  const built = Effect.fnUntraced(function* (home: string, target: Target, runtime: string) {
    const inputs = join(home, INPUTS);
    const landed = yield* releaseStaged(home, composition, {
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
    const image = join(home, platform.image.name(composition.channel, release, target));

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
      yield* platform.pack(join(landed.root, DESKTOP), archive, application).pipe(Effect.mapError((failure) => refusal('pack', failure)));
      yield* platform.image
        .make(join(landed.root, DESKTOP, application), image, composition.brand.assets, composition.channel.name, signer)
        .pipe(Effect.mapError((failure) => refusal('disk image', failure)));
      return kept;
    }).pipe(Effect.ensuring(Effect.sync(() => rmSync(landed.root, { recursive: true, force: true }))));

    const trouble = yield* archiveTrouble(archive, {
      labels,
      paths: machinePaths(checkout, out),
      comments,
      root: composition.applications.inside(application),
    });
    if (trouble.length > 0) {
      return yield* refuse('proof', `the archive is refused: ${trouble.join('; ')}`, [`${archive} — the refused archive, kept to be read`]);
    }
    return { archive, image };
  });

  const build = Effect.fnUntraced(function* (home: string): Effect.fn.Return<Built, ReleaseRefused, Machine> {
    logged = join(home, RELEASE_LOG);
    yield* files
      .copy(composition.brand.assets, join(home, BRAND), { overwrite: true })
      .pipe(Effect.mapError(unreadable(composition.brand.assets)));
    const platforms: Record<string, BuiltPlatform> = {};
    for (const { target, runtime } of runtimes) platforms[targetName(target)] = yield* built(home, target, runtime);
    return { platforms };
  });

  const native = platform.native();
  const tried = (trying: Trying, target: Target): Effect.Effect<void, ReleaseRefused> => {
    const name = targetName(target);
    const offered = trying.offer.platforms[name];
    if (offered === undefined) {
      return refuse('trial', `the release offers no ${name} archive to try`, [`${trying.log} — the cut it built`]);
    }
    return platform
      .trial({
        channel: composition.channel,
        archive: fileURLToPath(offered.archive),
        offer: trying.offer,
        predecessor: native !== null && targetName(native) === name ? (trying.predecessors[name] ?? null) : null,
        labels,
        scratch: tmpdir(),
        log: (line) => appendFileSync(trying.log, `\n=== trial ${name} ===\n${line}\n`),
        processes: composition.processes,
      })
      .pipe(
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
    trial: (trying) => Effect.forEach(platform.targets, (target) => tried(trying, target), { discard: true, concurrency: 'unbounded' }),
  };
  return yield* stagedCut(out, { release, commit: cut.head, stores, irreversible }, stages);
}, Effect.scoped);

const USAGE = 'bun run tagma:release [--version <x.y.z>] [--out <dir>] [--json]';

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

export const releaseCommand = Effect.fnUntraced(function* (given: readonly string[], composition: Composition, shown = true) {
  let json = given.includes('--json');
  const told = (code: string, reason: string, unblock: readonly string[] = [USAGE]): never => {
    if (json) console.log(JSON.stringify({ code, reason, unblock }));
    else console.error(refusalLines({ code, reason, unblock: [...unblock] }).join('\n'));
    process.exit(2);
  };
  const flags = flagsOf(given, told);
  json = flags.json;
  if (flags.rest.length > 0) told('usage', `${flags.rest.join(' ')} is not understood`);
  const data = dataDirectory(composition.workshop, process.env);
  if (data === null) return told('no-home', 'HOME names no home directory, so where the release is cut is unknown');
  const named = flags.value('--out');
  const out = named === undefined ? join(data, RELEASE_DIRECTORY) : resolve(named);
  const cut = yield* Effect.result(
    cutRelease({ composition, asked: flags.value('--version') ?? null, out, cache: cutCache(data) }).pipe(
      Effect.provide(Layer.mergeAll(gitLayer.pipe(Layer.provide(spawning)), spawning, BunFileSystem.layer)),
    ),
  );
  if (cut._tag === 'Failure') {
    return told('release-refused', `${cut.failure.step}: ${cut.failure.detail}`, [
      ...cut.failure.unblock,
      ...(cut.failure.log === '' ? [] : [`${cut.failure.log} — the whole output of every step of this release`]),
    ]);
  }
  if (!shown) return;
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
  ])
    console.log(line);
});
