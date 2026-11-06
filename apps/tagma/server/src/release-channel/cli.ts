import { existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Clock, Console, Effect, Logger, Schema } from 'effect';
import { Argument, Command, Flag } from 'effect/cli';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { CurrentInvocation, noting, print, refuse, write } from '../platform/cli/verb.js';
import { dataDirectoryHolder, dataDirectoryLocked } from '../platform/lock/holder.js';
import type { DirectoryHolder } from '../platform/contract/wire/lock.js';
import { databasePath, installationRoot, launcherPath } from '../installation/paths.js';
import { BUILD_ASKED_EVERY_MS } from '../installation/contract/wire/layout.js';
import { CURRENT } from '../platform/contract/wire/versions.js';
import type { Installed, Installing, NextFrame, NextOffer, Then } from '../installation/contract/wire/next.js';
import { placementSchema } from '../installation/contract/wire/placement.js';
import { INSTALLATION_OPERATIONS } from '../installation/contract/wire/operations.js';
import { json, machineState, serveLog, type Operating } from '../installation/cli/server.js';
import { readStartup } from '../installation/process/record.js';
import { comingUp, restartMismatch } from '../installation/process/serverStart.js';
import { RESTART_RECORD } from '../installation/contract/wire/restart.js';
import type { ServerCli } from '../installation/cli/port.js';
import { readInstallation, refusalDetail } from '../installation/closure/read.js';
import { versionsNewestFirst } from '../platform/lock/versionedDirectories.js';
import type { Applications } from '../installation/contract/service/applications.js';
import { InstalledChannel } from '../installation/contract/service/channel.js';
import type { Channel } from '../installation/contract/wire/channel.js';
import { directoryLeased } from '../platform/lock/directoryLease.js';
import { reachLine, writeLauncher } from '../installation/setup/launcher.js';
import { steppedBackAlone } from '../installation/cli/stepBack.js';
import { readOnlyWarning } from '../installation/voice/status.js';
import { installRelease, type Weigh } from './install.js';
import { weighedByServer } from './successor.js';
import { BACK } from './offers.js';
import { releasePlaces } from './places.js';

const readStarted = Schema.decodeUnknownResult(INSTALLATION_OPERATIONS.install_next.answer);
const readStopped = Schema.decodeUnknownResult(INSTALLATION_OPERATIONS.stop_installing.answer);
const readChecked = Schema.decodeUnknownResult(INSTALLATION_OPERATIONS.check_for_updates.answer);
const encodePlacement = Schema.encodeSync(Schema.fromJsonString(placementSchema));

const megabytes = (bytes: number): string => `${(bytes / 1024 ** 2).toFixed(0)} MB`;

const dataPath = (channel: Channel): string => dirname(databasePath(channel));

const offerLine = (offer: NextOffer): string =>
  [`${offer.title} ${offer.label}`, offer.size === null ? '' : `${megabytes(offer.size)} to download`].filter(Boolean).join(' · ');

const begin = ({ ask, here }: Operating, offer: string, then: Then | undefined): Effect.Effect<Installing, unknown> =>
  ask((door, at) =>
    door.operations.perform({ params: { id: 'install_next' }, query: here(at), headers: {}, payload: { offer, then } }),
  ).pipe(
    Effect.flatMap((answered) => {
      const read = readStarted(answered);
      if (read._tag !== 'Success' || read.success.status !== 'started')
        return Effect.fail(new Error('install_next answered outside its started shape'));
      return Effect.succeed((read.success as { readonly installing: Installing }).installing);
    }),
  );

const followed = Effect.fnUntraced(function* (
  cli: ServerCli,
  started: Installing,
  leaving: number,
  json: boolean,
  restartId: string | undefined,
) {
  let shown = -1;
  let announced: DirectoryHolder = null;
  const at = yield* CurrentInvocation;
  const url = cli.baseUrl(at);
  const local = cli.boundHere(at, url);
  const log = yield* serveLog(at);
  for (;;) {
    yield* Effect.sleep(BUILD_ASKED_EVERY_MS / 2);
    const read = yield* Effect.result(machineState(cli));
    if (read._tag === 'Failure') {
      yield* Effect.logDebug('the updating server did not answer', read.failure);
      const saved = yield* local ? readStartup(join(dirname(log), RESTART_RECORD)) : cli.startup();
      const failure =
        (saved.restart?.id !== restartId ? saved.restart?.failure : null) ??
        (saved.startup?.pid !== leaving ? saved.startup?.failure?.detail : null);
      if (failure != null) return refuse('restart-failed', `${url} did not restart: ${failure}`, [log, started.log]);
      const held = local ? dataDirectoryLocked(dirname(log)) : null;
      if (local && held === null && saved.restart?.underway !== true) {
        return refuse('server-not-up', `${url} does not answer, no process holds ${dirname(log)}, and no restart is under way`, [
          `${log} — what the successor printed`,
          `${started.log} — what the update printed`,
        ]);
      }
      if (held !== null && held !== announced) {
        announced = held;
        yield* comingUp(url, log)(held, saved.startup);
      }
      continue;
    }
    const handover = read.success.restart;
    if (handover.stage === 'failed' && handover.record?.id !== restartId) {
      return refuse('restart-failed', `${url} did not restart: ${handover.record?.failure?.detail}`, [log, started.log]);
    }
    const server = read.success.server;
    const ended: Installed | null = server.next.installed;
    if (server.pid !== leaving && started.then === 'restart') {
      const expected = ended?.since === started.since ? (ended.build ?? started.target) : started.target;
      const mismatch = restartMismatch(server.installation?.build ?? null, expected);
      if (mismatch !== null) return refuse('restart-failed', `${url} ${mismatch}`, [log, started.log]);
    }
    const running = server.next.installing;
    if (running !== null && running.since === started.since) {
      const done = running.progress?.done ?? 0;
      const total = running.progress?.total ?? 0;
      const percent = total === 0 ? null : Math.floor((done * 10) / total) * 10;
      if (!json && percent !== null && percent !== shown) {
        shown = percent;
        yield* Console.log(`${running.step} ${percent}% · ${megabytes(done)} of ${megabytes(total)}`);
      }
      continue;
    }
    if (ended === null || ended.since !== started.since) {
      if (server.pid !== leaving) return yield* Console.log(`the server restarted; ${started.title} ${started.target} stands`);
      return refuse('update-unread', 'the server no longer answers for the update it started', [
        `${started.log} — the whole output of the update`,
      ]);
    }
    if (ended.placement?.status === 'held' || ended.placement?.status === 'ask') {
      return yield* json ? print(ended, true) : Console.log(ended.detail);
    }
    if (ended.outcome !== 'landed') {
      return refuse(ended.outcome === 'stopped' ? 'update-stopped' : 'update-failed', ended.detail, [
        `${ended.log} — the whole output of the update`,
      ]);
    }
    if (ended.restartRefused !== null) {
      return refuse('restart-refused', `${ended.build ?? ended.target} stands, and the restart was refused: ${ended.restartRefused}`, [
        'tagma restart — ask again',
      ]);
    }
    if (ended.then === 'restart' && server.pid === leaving) continue;
    if (json) return yield* print(ended, true);
    return yield* Console.log(
      ended.then === 'restart' ? `the server runs ${ended.title.toLowerCase()} ${ended.build ?? ended.target} now` : ended.detail,
    );
  }
});

const moved = Effect.fnUntraced(function* (
  cli: ServerCli,
  offer: (next: NextFrame) => string | null,
  then: Then | undefined,
  o: { readonly json: boolean },
) {
  if ((yield* cli.healthOrNone()) === null)
    return refuse('server-not-up', 'no server answers here; the server installs releases', ['tagma web — start it']);
  const state = yield* machineState(cli);
  const next = state.server.next;
  const chosen = offer(next);
  if (chosen === null) return yield* Console.log(next.standing.said.map((part) => part.text).join(''));
  const named = [...next.offers, ...(next.back === null ? [] : [next.back])].find((one) => one.id === chosen);
  if (named !== undefined && !o.json) yield* Console.log(offerLine(named));
  const warned = named === undefined ? null : readOnlyWarning(named);
  if (warned !== null && !o.json) yield* Console.log(warned);
  const started = yield* begin(cli, chosen, then);
  if (!o.json) yield* Console.log(`${started.title} ${started.target} — output in ${started.log}`);
  yield* followed(cli, started, state.server.pid, o.json, state.restart.record?.id);
});

const update = (cli: ServerCli) =>
  Command.make(
    'update',
    {
      json,
      restart: Flag.Boolean('restart').pipe(
        Flag.withDefault(true),
        Flag.withDescription('restart onto the release once it stands; --no-restart only installs it'),
      ),
      stop: Flag.Boolean('stop').pipe(Flag.withDefault(false), Flag.withDescription('stop the update that runs')),
    },
    (o) =>
      Effect.gen(function* () {
        if (o.stop) {
          const answered = yield* cli.ask((door, at) =>
            door.operations.perform({ params: { id: 'stop_installing' }, query: cli.here(at), headers: {}, payload: {} }),
          );
          const read = readStopped(answered);
          if (read._tag !== 'Success' || read.success.status !== 'ended')
            return yield* Effect.fail(new Error('stop_installing answered outside its ended shape'));
          const stopped = (read.success as { readonly installed: Installed }).installed;
          return yield* o.json ? print(stopped, true) : Console.log(stopped.detail);
        }
        yield* moved(
          cli,
          (next) => {
            if (next.update !== null) return next.update;
            if (next.issue !== null) return refuse(next.issue.code, next.issue.reason, [...next.issue.unblock]);
            if (next.installing !== null)
              return refuse('install-running', `${next.installing.title} ${next.installing.target} installs already`, ['tagma status']);
            return null;
          },
          o.restart ? 'restart' : undefined,
          o,
        );
      }),
  ).pipe(
    Command.withDescription('download the newest release, install it beside the one that stands and restart onto it'),
    noting(`The standing server reads the release feed, downloads the archive the feed names,
checks its SHA-256, unpacks it and hands it to the release's own install-from, which makes it current; then the server restarts onto it
and the window reopens in the new release. Before it starts, this verb prints the
release and its download size. Nothing updates on its own.`),
  );

const check = (cli: ServerCli) =>
  Command.make('check', { json }, (o) =>
    Effect.gen(function* () {
      if ((yield* cli.healthOrNone()) === null)
        return refuse('server-not-up', 'no server answers here; the server reads the release feed', ['tagma web — start it']);
      const answered = yield* cli.ask((door, at) =>
        door.operations.perform({ params: { id: 'check_for_updates' }, query: cli.here(at), headers: {}, payload: {} }),
      );
      const read = readChecked(answered);
      if (read._tag !== 'Success' || read.success.status !== 'checked')
        return yield* Effect.fail(new Error('check_for_updates answered outside its checked shape'));
      const next = (read.success as { readonly next: NextFrame }).next;
      if (o.json) return yield* print(next, true);
      yield* Console.log(next.standing.said.map((part) => part.text).join(''));
      const offered = next.offers.find((offer) => offer.id === next.update);
      if (offered !== undefined) yield* Console.log(`${offerLine(offered)} — tagma release update installs it`);
      if (next.issue !== null) yield* Console.log(`${next.issue.code}: ${next.issue.reason}`);
    }),
  ).pipe(Command.withDescription('read the release feed now and print whether a newer release is out'));

const back = (cli: ServerCli) =>
  Command.make('back', { json }, (o) =>
    Effect.gen(function* () {
      if ((yield* cli.healthOrNone()) === null) {
        const channel = yield* InstalledChannel;
        return yield* steppedBackAlone(channel, o.json);
      }
      return yield* moved(
        cli,
        (next) => {
          if (next.back === null) return refuse('no-previous', 'no release is kept beside the one that stands', ['tagma status']);
          if (next.back.disabled !== null) return refuse('back-unavailable', next.back.disabled, ['tagma status — what stands']);
          return BACK;
        },
        'restart',
        o,
      );
    }),
  ).pipe(
    Command.withDescription('step back onto the release kept beside the one that stands, then restart onto it'),
    noting(`With no server running it returns the data here and makes that release the one that stands;
the next start brings it up.`),
  );

const removeVerb = Command.make('remove', { json }, (o) =>
  Effect.gen(function* () {
    const channel = yield* InstalledChannel;
    const data = dataPath(channel);
    const holder = dataDirectoryHolder(data);
    if (holder !== null) {
      return refuse('server-running', `a server (pid ${holder}) runs from these releases`, [
        `kill ${holder} — ends it gracefully; quit the window too, then tagma release remove`,
      ]);
    }
    const root = installationRoot(channel);
    const held = versionsNewestFirst(root).find((version) => directoryLeased(join(root, version)));
    if (held !== undefined) {
      return refuse('window-running', `a window runs from the release in ${join(root, held)}`, [
        'quit the Tagma window, then tagma release remove',
      ]);
    }
    const removed: string[] = [];
    for (const gone of [root, launcherPath(channel), releasePlaces(data).staging]) {
      if (!existsSync(gone)) continue;
      rmSync(gone, { recursive: true, force: true });
      removed.push(gone);
    }
    if (o.json) return yield* print({ removed, data }, true);
    for (const one of removed) yield* Console.log(`removed ${one}`);
    yield* Console.log(`the data stays in ${data}`);
  }),
).pipe(Command.withDescription('remove every installed release and the launcher; the data and the application where you keep it stay'));

const pathVerb = Command.make('path', {}, () =>
  Effect.gen(function* () {
    const at = yield* CurrentInvocation;
    const channel = yield* InstalledChannel;
    const root = installationRoot(channel);
    const read = yield* Effect.result(readInstallation(join(root, CURRENT)).pipe(Effect.provide(BunFileSystem.layer)));
    if (read._tag === 'Failure')
      return refuse('no-installation', refusalDetail(read.failure), [
        `open ${channel.name}.app — its first launch installs the release it carries`,
      ]);
    const written = yield* writeLauncher(root, launcherPath(channel), read.success.platform, at.env as NodeJS.ProcessEnv).pipe(
      Effect.provide(BunFileSystem.layer),
      Effect.catchTag('LauncherWriteFailed', (failure) =>
        Effect.sync(() => refuse('path-unwritten', `${failure.path}: ${failure.detail}`, [])),
      ),
    );
    yield* Console.log(reachLine(written));
  }),
).pipe(
  Command.withDescription('put tagma on PATH: write the line that puts the launcher first into the shell profile'),
  noting(`An installation never edits a shell profile on its own; this verb is the one that
does, when asked. Hooks call tagma by name and stay silent where it is not on PATH.`),
);

export const release = (cli: ServerCli) =>
  Command.make('release').pipe(
    Command.withDescription('the releases of Tagma on this machine: check, update, step back, remove, put on PATH'),
    Command.withSubcommands([check(cli), update(cli), back(cli), removeVerb, pathVerb]),
  );

const unweighed: Weigh = () => Effect.succeed({ _tag: 'Unasked', detail: 'the person agreed to a new execution host' });

export const installFrom = (cli: ServerCli, applications: Applications) =>
  Command.make(
    'install-from',
    {
      json,
      agreed: Flag.Boolean('agreed').pipe(
        Flag.withDefault(false),
        Flag.withDescription('install even where --json would ask first: the person agreed to the question'),
      ),
      newHost: Flag.Boolean('new-host').pipe(
        Flag.withDefault(false),
        Flag.withDescription('make it current even where the execution host of the running server would not take it'),
      ),
      directory: Argument.String('directory'),
    },
    (o) =>
      Effect.gen(function* () {
        const at = yield* CurrentInvocation;
        const channel = yield* InstalledChannel;
        const answer = yield* installRelease(
          resolve(at.cwd, o.directory),
          { installRoot: installationRoot(channel), launcher: launcherPath(channel), name: channel.name },
          applications,
          new Date(yield* Clock.currentTimeMillis),
          o.json && !o.agreed,
          o.newHost ? unweighed : weighedByServer(cli),
        ).pipe(
          Effect.provide(BunFileSystem.layer),
          Effect.catchTag('ReleaseNotInstalled', (failure) =>
            Effect.sync(() =>
              refuse(failure.code ?? 'release-not-installed', `${failure.step}: ${failure.reason}`, [...failure.unblock], failure.words),
            ),
          ),
        );
        if (o.json) return yield* write(`${encodePlacement(answer)}\n`);
        if (answer.status === 'ask') return yield* Console.log(`${answer.said} — install-from --agreed installs it`);
        if (answer.status === 'held') {
          yield* Console.log(
            `release ${answer.build} stands in ${answer.root}, and ${answer.standing ?? 'the release that stands'} stays current: the execution host of the running server does not take it (${answer.detail})`,
          );
          return yield* Console.log(`tagma status names what a new execution host ends; restart_server {"host":"replace"} updates onto it`);
        }
        yield* Console.log(
          `release ${answer.build} stands in ${answer.root}${answer.previous === null ? '' : `, beside ${answer.previous}`}`,
        );
        yield* Console.log(`the launcher is ${answer.launcher}; tagma release path puts it on PATH`);
      }).pipe(Effect.provideService(Logger.LogToStderr, true)),
  ).pipe(
    Command.withDescription('install the release an application carries: prove it, copy it, and make it the one that stands'),
    noting(`The one entry that installs a release: \`<directory>/bun <directory>/bin/cli/main.js
install-from <directory>\`, where the directory is Contents/Resources/release of Tagma.app.
It checks the application's signature and every part against install.json, and refuses a
release older than the one that stands. It copies the application into install/<v>/desktop,
clones the release beside it and bun into the execution host's bundle, takes the copies out of
quarantine, writes the launcher without touching a shell profile, records the attempt {from, to}
and switches current last; the server of the new release clears the attempt once its local door
opens, or rolls it back. With --json it prints one line: {"status":"landed",…}, or
{"status":"ask","reason":"stepped-back"|"failed","said":…} when the person is asked
first — --agreed installs anyway.`),
  );
