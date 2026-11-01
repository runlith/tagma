import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { Cause, Clock, Duration, Effect, Exit, Fiber, FileSystem, Layer, PubSub, Schema, Scope, Semaphore, Stream } from 'effect';
import { HttpClient } from 'effect/http';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { type InstallRefused, NextInstallation, type StopRefused } from '../installation/contract/service/next.js';
import type { Applications } from '../installation/contract/service/applications.js';
import type { MachinePlatform } from '../installation/contract/service/platform.js';
import { DowngradeSteps } from '../installation/contract/service/steps.js';
import {
  type Installed,
  type Installing,
  installedSchema,
  installingSchema,
  type NextFrame,
  type NextIssue,
  type Then,
} from '../installation/contract/wire/next.js';
import { CLI_ENTRY, CURRENT, RUNTIME_PART, SERVE_FLAGS } from '../installation/contract/wire/layout.js';
import { type Installation, releaseApplication } from '../installation/contract/wire/manifest.js';
import { writeReturn } from '../installation/closure/attempt.js';
import { currentVersion, releasesNewestFirst, swapCurrent } from '../installation/closure/versions.js';
import { manifestAt, releaseAt } from '../installation/closure/manifests.js';
import { downgradePreflight } from '../installation/operations/downgrade.js';
import { holdDirectory } from '../platform/lock/directoryLease.js';
import { Settings } from '../settings/contract/service/values.js';
import { archiveRefusal, unpackCommand } from './archive.js';
import { logged } from './child.js';
import { downloaded, Undelivered, undelivered } from './delivery.js';
import { type Feed, type ReleaseArchive, feedSchema } from '../installation/contract/wire/feed.js';
import { readFeed, releaseFor, type ReleaseChoice } from './feed.js';
import { provenRelease } from './install.js';
import {
  BACK,
  BACK_TITLE,
  backRefused,
  frameOf,
  noWayBackTo,
  type Previous,
  RELEASE_TITLE,
  STEPS,
  type StepId,
  stepsOf,
} from './offers.js';
import type { ReleasePlaces } from './places.js';
import { releaseFeed } from './settings.js';

const FEED_EVERY = Duration.hours(24);
const SPACE_MARGIN = 1.25;
const PACKED_RATIO = 3;
const TAIL_LINES = 20;
const TAIL_BYTES = 8192;

const keptSchema = Schema.Struct({
  feed: Schema.NullOr(feedSchema),
  installing: Schema.NullOr(installingSchema),
  installed: Schema.NullOr(installedSchema),
  took: Schema.NullOr(Schema.Number),
});

const decodeKept = Schema.decodeUnknownResult(Schema.fromJsonString(keptSchema));
const encodeKept = Schema.encodeSync(Schema.fromJsonString(keptSchema, { space: 2 }));

export type ChannelPlace = {
  readonly installations: string;
  readonly name: string;
  readonly running: string;
  readonly runsFrom: Installation | undefined;
  readonly places: ReleasePlaces;
  readonly applications: Applications;
  readonly machine: MachinePlatform;
  readonly downgrade: DowngradeSteps['Service'];
  readonly restart: () => Promise<string | null>;
  readonly refuses: (root: string) => Promise<string | null>;
  readonly env: NodeJS.ProcessEnv;
};

type Delivering = {
  readonly installing: Installing;
  readonly fiber: Fiber.Fiber<string | null, Undelivered> | null;
  readonly landed: string | null;
};

type Target = { readonly release: ReleaseArchive } | { readonly previous: Previous };

const tailOf = (log: string, from: number): string[] => {
  if (!existsSync(log)) return [];
  const handle = openSync(log, 'r');
  try {
    const size = fstatSync(handle).size;
    const start = Math.max(from, size - TAIL_BYTES);
    if (start >= size) return [];
    const bytes = Buffer.alloc(size - start);
    readSync(handle, bytes, 0, bytes.length, start);
    return bytes
      .toString('utf8')
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line !== '')
      .slice(-TAIL_LINES);
  } finally {
    closeSync(handle);
  }
};

const sizeOf = (path: string): number => (existsSync(path) ? statSync(path).size : 0);

const standingAt = (path: string): string => (existsSync(path) ? path : standingAt(dirname(path)));

const freeBytes = (path: string): number => {
  const stats = statfsSync(path);
  return Number(stats.bavail) * Number(stats.bsize);
};

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

const megabytes = (bytes: number) => `${Math.ceil(bytes / 1024 ** 2)} MB`;
const gigabytes = (bytes: number) => (Math.ceil((bytes / 1024 ** 3) * 10) / 10).toFixed(1);

const landedDetail = (landed: string | null, then: Then | null): string =>
  then === 'restart'
    ? `release ${landed ?? 'the release'} stands, and the server restarts onto it`
    : `release ${landed ?? 'the release'} stands; tagma restart brings it up`;

const occupied = (busy: Installing): InstallRefused => ({
  code: 'install-running',
  reason: `${busy.title} ${busy.target} installs since ${busy.since}, and this call did not name it as the one to stop`,
  unblock: [
    "install_next again: it names the installation that runs now, and stops it first with the operator's word",
    'tagma status — where it stands',
  ],
});

const restarting = (busy: Installing): InstallRefused & StopRefused => ({
  code: 'install-restarting',
  reason: `${busy.title} ${busy.target} landed and the restart onto it is already asked`,
  unblock: ['tagma status — where the server stands once the successor answers'],
});

export const makeReleaseChannel = Effect.fnUntraced(function* (place: ChannelPlace) {
  const settings = yield* Settings;
  const client = yield* HttpClient.HttpClient;
  const scope = yield* Scope.Scope;
  const clock = yield* Clock.Clock;
  const files = yield* FileSystem.FileSystem;
  const machine = yield* Effect.result(
    place.machine.current.pipe(
      Effect.mapError((failure): NextIssue => ({
        code: 'platform-unavailable',
        reason: failure.reason,
        unblock: ['restart Tagma once the machine platform can be read'],
      })),
    ),
  );
  const admission = yield* Semaphore.make(1);
  const feeds = yield* settings.changes(releaseFeed).pipe(Effect.orDie);
  const serving = place.runsFrom?.root;
  if (serving !== undefined) {
    yield* Effect.acquireRelease(
      Effect.sync(() => holdDirectory(serving)),
      (held) => Effect.sync(() => held?.()),
    );
  }
  const frames = yield* Effect.acquireRelease(PubSub.sliding<NextFrame>({ capacity: 1, replay: 1 }), PubSub.shutdown);
  const instance = crypto.randomUUID();
  const stamp = () => new Date(clock.currentTimeMillisUnsafe()).toISOString();
  let revision = 0;
  let feed: Feed | null = null;
  let issue: NextIssue | null = null;
  let readAt = stamp();
  let readFrom: string | null = null;
  let previous: Previous | null = null;
  let delivering: Delivering | null = null;
  let installed: Installed | null = null;
  let took: number | null = null;
  let shown = -1;
  let feedUrl: string | null = null;
  let logFrom = 0;

  const choice = (): ReleaseChoice =>
    machine._tag === 'Failure'
      ? { release: null, issue: machine.failure }
      : feed === null
        ? { release: null, issue: null }
        : releaseFor(feed, place.running, machine.success);

  const frame = (): NextFrame =>
    frameOf({
      instance,
      revision,
      readAt,
      readFrom,
      feed,
      issue,
      choice: choice(),
      running: place.running,
      previous,
      installing: delivering?.installing ?? null,
      installed,
    });

  const shift = Effect.fnUntraced(function* () {
    revision += 1;
    yield* PubSub.publish(frames, frame());
  });

  const stepped = Effect.fnUntraced(function* (step: StepId, progress: Installing['progress'] = null) {
    const active = delivering;
    if (active === null) return;
    delivering = { ...active, installing: { ...active.installing, step: STEPS[step].id, progress } };
    yield* shift();
  });

  const progressed = Effect.fnUntraced(function* (done: number, total: number) {
    const percent = total === 0 ? 100 : Math.floor((done * 100) / total);
    if (percent === shown) return;
    shown = percent;
    yield* stepped('download', { done, total });
  });

  const say = (line: string): void => {
    mkdirSync(dirname(place.places.log), { recursive: true });
    appendFileSync(place.places.log, `${line}\n`);
  };

  const readKept = () => {
    const at = place.places.record;
    if (!existsSync(at)) return null;
    const decoded = decodeKept(readFileSync(at, 'utf8'));
    if (decoded._tag === 'Success') return decoded.success;
    renameSync(at, `${at}.unread`);
    console.warn(`[tagma] the update record did not read, so it was set aside at ${at}.unread: ${decoded.failure.message}`);
    return null;
  };

  const keep = (building = delivering?.installing ?? null, last = installed): void => {
    const at = place.places.record;
    mkdirSync(dirname(at), { recursive: true });
    const passing = `${at}.${process.pid}`;
    writeFileSync(passing, encodeKept({ feed, installing: building, installed: last, took }), { mode: 0o600 });
    renameSync(passing, at);
  };

  const endedOf = (
    building: Installing,
    outcome: Installed['outcome'],
    build: string | null,
    detail: string,
    tail: readonly string[],
    restartRefused: string | null = null,
  ): Installed => ({
    offer: building.offer,
    title: building.title,
    target: building.target,
    outcome,
    build,
    detail,
    endedAt: stamp(),
    log: building.log,
    since: building.since,
    tail: [...tail],
    then: building.then,
    restartRefused,
  });

  const reconciled = (building: Installing): Installed => {
    const standing = currentVersion(place.installations);
    const build = standing === null ? null : (releaseAt(place.installations, standing)?.identity.build ?? null);
    if (build !== null && build === building.target) {
      return endedOf(building, 'landed', build, `release ${build} became current before the server that installed it ended`, []);
    }
    return endedOf(building, 'failed', null, 'the server that ran this installation ended before it did', []);
  };

  const measureBack: Effect.Effect<void> = Effect.promise(async () => {
    const versions = releasesNewestFirst(place.installations);
    const standing = currentVersion(place.installations);
    const at = standing === null ? -1 : versions.indexOf(standing);
    const version = at < 0 ? undefined : versions[at + 1];
    if (version === undefined || standing === null) {
      previous = null;
      return;
    }
    const root = join(place.installations, version);
    const read = manifestAt(root);
    if (read._tag !== 'Read') {
      const why = read._tag === 'Malformed' ? `: ${read.detail}` : '';
      previous = {
        version,
        root,
        build: null,
        refused: backRefused.unreadable(version, `${root} holds no installation manifest that reads${why}`),
      };
      return;
    }
    const build = read.manifest.identity.build;
    const declared = [...(place.runsFrom?.manifest.irreversible ?? []), ...(releaseAt(place.installations, standing)?.irreversible ?? [])];
    const changes = [...new Map(declared.map((one) => [`${one.store} ${one.release}`, one])).values()];
    const refused = noWayBackTo(changes, build, place.running) ?? (await place.refuses(root));
    previous = { version, root, build, refused: refused === null ? null : backRefused.unreadableData(version, refused) };
  });

  const refresh = Effect.fn('ReleaseChannel.refresh')(function* () {
    const url = feedUrl;
    if (url === null) return;
    const read = yield* Effect.result(readFeed(client, url));
    readAt = stamp();
    readFrom = url;
    if (read._tag === 'Success') {
      feed = read.success;
      issue = null;
    } else issue = read.failure;
    yield* measureBack;
    keep();
    yield* shift();
  });

  const targetOf = Effect.fnUntraced(function* (offer: string): Effect.fn.Return<Target, InstallRefused> {
    if (offer === BACK) {
      const kept = previous;
      if (kept === null) {
        return yield* Effect.fail<InstallRefused>({
          code: 'no-offer',
          reason: 'no release is kept beside the one that stands, so there is nothing to step back onto',
          unblock: ['tagma status — the releases offered here'],
          words: { text: 'There is no earlier version of Tagma to go back to.' },
        });
      }
      if (kept.refused !== null) {
        return yield* Effect.fail<InstallRefused>({
          code: 'offer-unavailable',
          reason: kept.refused.why,
          unblock: ['tagma status — what stands'],
          words: { text: `${kept.refused.said}.` },
        });
      }
      return { previous: kept };
    }
    if (feed === null && issue !== null) return yield* Effect.fail<InstallRefused>(issue);
    const selected = choice();
    if (selected.issue !== null) return yield* Effect.fail<InstallRefused>(selected.issue);
    const offered = selected.release;
    if (offered?.release === offer) return { release: offered };
    return yield* Effect.fail<InstallRefused>({
      code: 'no-offer',
      reason:
        offered === null
          ? `${offer} is not offered: no release after ${place.running} is offered here`
          : `${offer} is not offered: the release offered after ${place.running} is ${offered.release}, and tagma release back is the one way down`,
      unblock: ['tagma status — the releases offered here'],
    });
  });

  const admitted = Effect.fnUntraced(function* (release: ReleaseArchive) {
    const unusable = (reason: string) =>
      Effect.fail<InstallRefused>({ code: 'offer-unavailable', reason, unblock: ['tagma status — the release the feed names'] });
    const address = URL.parse(release.archive);
    if (address?.protocol === 'file:' && feedUrl?.startsWith('file:') !== true) {
      return yield* unusable(`release ${release.release} names a file on this machine as its archive, and only a feed on this machine may`);
    }
    if (!['file:', 'https:'].includes(address?.protocol ?? '') && !(address?.protocol === 'http:' && LOOPBACK.has(address.hostname))) {
      return yield* unusable(`release ${release.release} names ${release.archive}; an archive downloads over https`);
    }
  });

  const spaced = Effect.fnUntraced(function* (release: ReleaseArchive) {
    const staging = place.places.staging;
    mkdirSync(staging, { recursive: true });
    const unpacked = (place.runsFrom?.manifest.parts ?? []).reduce((sum, part) => sum + part.bytes, 0);
    const tree = (unpacked > 0 ? unpacked : release.size * PACKED_RATIO) * SPACE_MARGIN;
    const installs = standingAt(place.installations);
    const apart = statSync(installs).dev !== statSync(staging).dev;
    const asks: ReadonlyArray<readonly [string, number]> = apart
      ? [
          [staging, release.size + tree],
          [installs, tree],
        ]
      : [[staging, release.size + tree]];
    for (const [at, needed] of asks) {
      const free = freeBytes(at);
      if (free >= needed) continue;
      return yield* Effect.fail<InstallRefused>({
        code: 'offer-unavailable',
        reason: `release ${release.release} needs about ${megabytes(needed)} free in ${at} to download and unpack, and ${megabytes(free)} stand free`,
        unblock: ['free disk space, then tagma release update'],
        words: { text: `Not enough disk space to update: free about ${gigabytes(needed - free)} GB, then try again.` },
      });
    }
  });

  const halt = Effect.fnUntraced(function* (active: Delivering) {
    if (active.fiber !== null) yield* Fiber.interrupt(active.fiber);
    return installed?.since === active.installing.since ? installed : null;
  });

  const ran = Effect.fn('ReleaseChannel.ran')(function* (title: string, command: readonly string[]) {
    const code = yield* Effect.acquireUseRelease(
      Effect.sync(() => {
        say(`\n--- ${title}: ${command.join(' ')} ---`);
        return openSync(place.places.log, 'a');
      }),
      (sink) => logged(command, place.env, sink),
      (sink) => Effect.sync(() => closeSync(sink)),
    );
    if (code !== 0) return yield* undelivered(`${title} ended with code ${code}`);
  });

  const clean = Effect.fn('ReleaseChannel.clean')(function* (path: string) {
    yield* files.remove(path, { recursive: true, force: true }).pipe(Effect.orDie);
  }, Effect.uninterruptible);

  const unpacked = Effect.fn('ReleaseChannel.unpack')(function* (release: ReleaseArchive, file: string) {
    const into = join(place.places.staging, release.release);
    yield* clean(into);
    mkdirSync(into, { recursive: true });
    const refusal = yield* archiveRefusal(file, place.env);
    if (refusal !== null) return yield* undelivered(`the archive of release ${release.release} is refused before it unpacks: ${refusal}`);
    yield* ran('unpack', unpackCommand(file, into));
    rmSync(file, { force: true });
    const carried = place.applications.carried(into);
    if (carried === null) return yield* undelivered(`the archive of release ${release.release} holds no one application at its root`);
    const unsigned = yield* Effect.promise((signal) => place.applications.signature(carried, place.installations, signal));
    if (unsigned !== null) return yield* undelivered(`release ${release.release} is refused before it runs: ${unsigned}`);
    const proven = yield* provenRelease(carried).pipe(
      Effect.provide(BunFileSystem.layer),
      Effect.mapError((failure) => undelivered(`release ${release.release} does not prove itself at ${failure.step}: ${failure.reason}`)),
    );
    const installing = [join(carried, RUNTIME_PART), ...SERVE_FLAGS, join(carried, CLI_ENTRY), 'install-from', carried];
    yield* Effect.uninterruptible(
      Effect.gen(function* () {
        yield* ran('install-from', installing);
        if (delivering !== null) delivering = { ...delivering, landed: proven.identity.build };
      }),
    );
    yield* clean(into);
  });

  const deliver = Effect.fn('ReleaseChannel.deliver')(function* (release: ReleaseArchive) {
    const started = clock.currentTimeMillisUnsafe();
    const file = join(place.places.staging, `${release.release}.tar.gz`);
    const digest = yield* downloaded(client, release, file, progressed);
    yield* stepped('verify');
    if (digest !== release.sha256) return yield* undelivered(`the archive's SHA-256 is ${digest}, and the feed names ${release.sha256}`);
    yield* stepped('install');
    yield* unpacked(release, file);
    took = clock.currentTimeMillisUnsafe() - started;
  });

  const stepBack = Effect.fn('ReleaseChannel.stepBack')(function* (target: Previous) {
    const refused = yield* Effect.promise(() => place.refuses(target.root));
    if (refused !== null) return yield* undelivered(refused);
    const read = manifestAt(target.root);
    if (read._tag !== 'Read') return yield* undelivered(`${target.root} holds no installation manifest that reads`);
    const kept = releaseApplication(target.root, place.name);
    if (!existsSync(kept)) return yield* undelivered(`no application of release ${target.build ?? target.version} is kept at ${kept}`);
    yield* downgradePreflight().pipe(
      Effect.provideService(DowngradeSteps, place.downgrade),
      Effect.mapError((failure) => undelivered(failure.reason)),
    );
    yield* Effect.try({
      try: () => {
        writeReturn(place.installations, place.running, target.version);
        swapCurrent(place.installations, target.version);
      },
      catch: (cause) => undelivered(`the step back could not make release ${target.build ?? target.version} current: ${String(cause)}`),
    }).pipe(Effect.onError(() => place.downgrade.reopen()));
    say(`${CURRENT} → ${target.version} (${target.build ?? 'unnamed'})`);
    if (delivering !== null) delivering = { ...delivering, landed: target.build ?? target.version };
  });

  const landedOf = (building: Installing): string | null => (delivering?.installing.since === building.since ? delivering.landed : null);

  const restarted = Effect.fn('ReleaseChannel.restarted')(function* (building: Installing) {
    if (building.then !== 'restart') return null;
    const landed = landedOf(building);
    yield* stepped('restart');
    keep(null, endedOf(building, 'landed', landed, landedDetail(landed, building.then), []));
    say(`=== then restart, asked by pid ${process.pid} ===`);
    const refused = yield* Effect.promise(() =>
      place.restart().catch((cause: unknown) => `the restart could not be asked: ${String(cause)}`),
    );
    if (refused !== null && building.offer === BACK) yield* place.downgrade.reopen();
    say(refused === null ? '=== restart asked: the successor stands by ===' : `=== restart refused: ${refused} ===`);
    return refused;
  });

  const failedOf = (building: Installing, cause: Cause.Cause<Undelivered>): Installed => {
    const failure = Cause.findErrorOption(cause);
    const detail = failure._tag === 'Some' ? failure.value.detail : `the installation broke: ${Cause.pretty(cause)}`;
    return endedOf(building, 'failed', null, detail, tailOf(place.places.log, logFrom));
  };

  const settle = Effect.fn('ReleaseChannel.settle')(function* (building: Installing, exit: Exit.Exit<string | null, Undelivered>) {
    const landed = landedOf(building);
    const ended = Exit.isSuccess(exit)
      ? endedOf(building, 'landed', landed, landedDetail(landed, building.then), [], exit.value)
      : Cause.hasInterruptsOnly(exit.cause)
        ? landed === null
          ? endedOf(building, 'stopped', null, `stopped at the ${building.step} step; nothing landed`, [])
          : endedOf(building, 'landed', landed, `stopped after release ${landed} became current; tagma restart brings it up`, [])
        : failedOf(building, exit.cause);
    yield* clean(place.places.staging);
    installed = ended;
    delivering = null;
    say(`=== ${building.title} ${building.target} ${ended.outcome} ${ended.endedAt}: ${ended.detail} ===`);
    yield* measureBack;
    keep();
    yield* shift();
  });

  const record = readKept();
  feed = record?.feed ?? null;
  took = record?.took ?? null;
  installed = record?.installing === null || record?.installing === undefined ? (record?.installed ?? null) : reconciled(record.installing);
  yield* clean(place.places.staging);
  keep();
  yield* shift();

  yield* Effect.forkScoped(
    Stream.runForEach(Stream.changes(feeds), (url) => {
      feedUrl = url.trim() === '' ? null : url;
      if (feedUrl !== null) return refresh();
      feed = null;
      issue = null;
      readFrom = null;
      keep();
      return shift();
    }),
  );
  yield* Effect.forkScoped(Effect.forever(Effect.andThen(Effect.sleep(FEED_EVERY), refresh())));

  return NextInstallation.of({
    reading: Effect.sync(frame),
    changes: Stream.fromPubSub(frames),
    installing: Effect.sync(() => delivering?.installing ?? null),
    install: Effect.fn('NextInstallation.install')(
      function* (offer, then, replacing) {
        const standing = delivering;
        if (standing !== null && standing.installing.step === STEPS.restart.id) return yield* Effect.fail(restarting(standing.installing));
        if (standing !== null && standing.installing.since !== replacing) return yield* Effect.fail(occupied(standing.installing));
        if (offer === BACK) yield* measureBack;
        const target = yield* targetOf(offer);
        if ('release' in target) yield* admitted(target.release);
        const replaced = standing === null ? null : yield* halt(standing);
        if (delivering !== null) return yield* Effect.fail(occupied(delivering.installing));
        yield* clean(place.places.staging);
        if ('release' in target) yield* spaced(target.release);
        const back = 'previous' in target;
        const restarts = back || then === 'restart';
        const installing: Installing = {
          offer,
          title: back ? BACK_TITLE : RELEASE_TITLE,
          target: 'previous' in target ? (target.previous.build ?? target.previous.version) : target.release.release,
          since: stamp(),
          log: place.places.log,
          then: restarts ? 'restart' : null,
          steps: stepsOf(back, restarts),
          step: back ? STEPS.back.id : STEPS.download.id,
          progress: null,
          tail: null,
          usually: back ? null : took,
        };
        shown = -1;
        delivering = { installing, fiber: null, landed: null };
        logFrom = sizeOf(place.places.log);
        say(`\n=== ${installing.title} ${installing.target} started ${installing.since} by pid ${process.pid} ===`);
        const work = 'previous' in target ? stepBack(target.previous) : deliver(target.release);
        const fiber = yield* Effect.forkIn(
          Effect.onExit(work.pipe(Effect.andThen(restarted(installing))), (exit) => settle(installing, exit)).pipe(Effect.interruptible),
          scope,
        );
        if (delivering?.installing === installing) delivering = { ...delivering, fiber };
        keep();
        yield* shift();
        return { installing, replaced };
      },
      Effect.uninterruptible,
      admission.withPermit,
    ),
    stop: Effect.fn('NextInstallation.stop')(
      function* () {
        const active = delivering;
        if (active === null) {
          return yield* Effect.fail<StopRefused>({
            code: 'nothing-installing',
            reason: 'no release is installing, so there is nothing to stop',
            unblock: ['tagma status — where the server stands'],
          });
        }
        if (active.installing.step === STEPS.restart.id) return yield* Effect.fail(restarting(active.installing));
        const ended = yield* halt(active);
        if (ended === null) {
          return yield* Effect.fail<StopRefused>({
            code: 'nothing-installing',
            reason: 'the installation ended and left no record of how',
            unblock: [`${active.installing.log} — what it printed`],
          });
        }
        return ended;
      },
      Effect.uninterruptible,
      admission.withPermit,
    ),
  });
});

export const releaseChannelLayer = (place: ChannelPlace) =>
  Layer.effect(NextInstallation, makeReleaseChannel(place)).pipe(Layer.provide(BunFileSystem.layer));
