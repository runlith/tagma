import { dirname, join } from 'node:path';
import { Console, Effect, Schema } from 'effect';
import { Command, Flag } from 'effect/cli';
import { ASKED_EVERY_MS, BUILD_ASKED_EVERY_MS, BUILD_COMMAND } from '../installation/contract/wire/layout.js';
import { dataDirectoryLocked } from '../platform/lock/holder.js';
import type { DirectoryHolder } from '../platform/contract/wire/lock.js';
import { refuse, noting, CurrentInvocation, print } from '../platform/cli/verb.js';
import type { Installed, Installing, Then } from '../installation/contract/wire/next.js';
import { INSTALLATION_OPERATIONS } from '../installation/contract/wire/operations.js';
import { json, machineState, serveLog, type Operating } from '../installation/cli/server.js';
import type { ServerCli } from '../installation/cli/port.js';
import { comingUp, restartMismatch } from '../installation/process/serverStart.js';
import { readStartup } from '../installation/process/record.js';
import { RESTART_RECORD } from '../installation/contract/wire/restart.js';
import { steppedBackAlone } from '../installation/cli/stepBack.js';
import { InstalledChannel } from '../installation/contract/service/channel.js';
import type { BuildFrom } from './record.js';

const readStarted = Schema.decodeUnknownResult(INSTALLATION_OPERATIONS.install_next.answer);
const readStopped = Schema.decodeUnknownResult(INSTALLATION_OPERATIONS.stop_installing.answer);

const installNext = (
  { ask, here }: Operating,
  payload: { readonly offer: BuildFrom; readonly then?: Then },
  quiet: boolean,
): Effect.Effect<Installing, unknown> =>
  ask((door, at) => door.operations.perform({ params: { id: 'install_next' }, query: here(at), headers: {}, payload })).pipe(
    Effect.flatMap((answered) => {
      const read = readStarted(answered);
      if (read._tag !== 'Success' || read.success.status !== 'started') {
        return Effect.fail(new Error('install_next answered outside its started shape'));
      }
      const { installing, replaced } = read.success as { readonly installing: Installing; readonly replaced: Installed | null };
      return Effect.as(
        replaced === null || quiet
          ? Effect.void
          : Console.log(`stopped the build from ${replaced.offer} ${replaced.target} that ran since ${replaced.since ?? replaced.endedAt}`),
        installing,
      );
    }),
  );

const stopInstalling = ({ ask, here }: Operating): Effect.Effect<Installed, unknown> =>
  ask((door, at) => door.operations.perform({ params: { id: 'stop_installing' }, query: here(at), headers: {}, payload: {} })).pipe(
    Effect.flatMap((answered) => {
      const read = readStopped(answered);
      if (read._tag !== 'Success' || read.success.status !== 'ended') {
        return Effect.fail(new Error('stop_installing answered outside its ended shape'));
      }
      return Effect.succeed((read.success as { readonly installed: Installed }).installed);
    }),
  );

const buildHead = Flag.Boolean('head').pipe(
  Flag.withDefault(false),
  Flag.withDescription('a clean cut of HEAD, in a worktree that leaves with the build'),
);
const buildTree = Flag.Boolean('tree').pipe(
  Flag.withDefault(false),
  Flag.withDescription('the tree as it stands, uncommitted changes included'),
);
const buildBack = Flag.Boolean('back').pipe(
  Flag.withDefault(false),
  Flag.withDescription('step back onto the installation kept beside the one that stands, then restart'),
);
const buildStop = Flag.Boolean('stop').pipe(Flag.withDefault(false), Flag.withDescription('stop the build that runs, restarting nothing'));

export const build = ({ ask, baseUrl, healthOrNone, here }: ServerCli) =>
  Command.make('build', { json, head: buildHead, tree: buildTree, stop: buildStop }, (o) =>
    Effect.gen(function* () {
      if (o.stop) {
        if (o.head || o.tree)
          return refuse('build-from', 'stopping a build and starting one are two acts, and this verb runs one', [
            'tagma build --stop',
            'tagma build --head',
            'tagma build --tree',
          ]);
        const stopped = yield* stopInstalling({ ask, here });
        if (o.json) return yield* print(stopped, true);
        yield* Console.log(
          stopped.outcome === 'stopped'
            ? `stopped the build from ${stopped.offer} ${stopped.target}; the installation that stood still stands`
            : `${stopped.detail} (from ${stopped.offer} ${stopped.target})`,
        );
        return;
      }
      if (o.head === o.tree) {
        return refuse(
          'build-from',
          o.head ? 'HEAD and the tree are two builds, and this verb runs one' : 'nothing says what to build from',
          ['tagma build --head — a clean cut of HEAD', 'tagma build --tree — the tree as it stands'],
        );
      }
      const url = baseUrl(yield* CurrentInvocation);
      const standing = yield* healthOrNone();
      if (standing === null)
        return refuse('server-not-up', `nothing answers at ${url}; the server runs the build`, ['tagma web — start it']);
      const started = yield* installNext({ ask, here }, { offer: o.head ? 'head' : 'tree' }, o.json);
      if (!o.json) yield* Console.log(`building ${started.offer} ${started.target} — output in ${started.log}`);
      for (;;) {
        yield* Effect.sleep(BUILD_ASKED_EVERY_MS);
        const read = yield* Effect.result(machineState({ ask, here }));
        if (read._tag === 'Failure') {
          yield* Effect.logDebug('the server did not answer while the build ran', read.failure);
          continue;
        }
        const next = read.success.server.next;
        if (next.installing !== null && next.installing.since === started.since) continue;
        const ended = next.installed;
        if (ended === null)
          return refuse('build-unread', `${url} no longer runs the build it started; its outcome is in the log`, [
            `${started.log} — the whole output of the build`,
          ]);
        if (o.json) return yield* print(ended, true);
        if (ended.outcome === 'landed') {
          yield* Console.log(`${ended.build ?? 'the build'} landed from ${ended.offer} ${ended.target} — tagma restart brings it up`);
        } else if (ended.outcome === 'stopped') {
          return refuse('build-stopped', `${ended.detail} (from ${ended.offer} ${ended.target})`, [
            `${ended.log} — what it printed before it stopped`,
          ]);
        } else {
          return refuse('build-failed', `${ended.detail} (from ${ended.offer} ${ended.target})`, [
            `${ended.log} — the whole output of the build`,
          ]);
        }
        return;
      }
    }),
  ).pipe(
    Command.withDescription(
      'build an installation from the checkout this Tagma was cut from: --head a clean cut, --tree as it stands; --stop ends the one that runs',
    ),
    noting(`The standing server runs the checkout's own \`${BUILD_COMMAND}\` — for \`--head\` in a
worktree cut at HEAD beside the data directory, installed from the lockfile and
removed after; for \`--tree\` in the checkout as it stands. The installation
that lands becomes \`current\`, and \`tagma restart\` brings it up. Where this Tagma
was installed rather than cut from a checkout on this machine, there is nothing
to build from and the verb refuses; \`tagma status\` lists no build there.
\`--stop\` ends the build that runs, an update's included, before its restart is
asked: every process it started ends, its worktree and the version it was writing
are removed, and the installation that stood stays \`current\`.`),
  );

export const update = ({ ask, baseUrl, boundHere, healthOrNone, here, startup }: ServerCli) =>
  Command.make('update', { json, head: buildHead, tree: buildTree, back: buildBack }, (o) =>
    Effect.gen(function* () {
      const chosen = [o.head ? 'head' : null, o.tree ? 'tree' : null, o.back ? 'back' : null].filter(
        (one): one is BuildFrom => one !== null,
      );
      const offer = chosen[0];
      if (offer === undefined || chosen.length > 1) {
        return refuse(
          'update-from',
          chosen.length > 1 ? 'these are separate updates, and this verb runs one' : 'nothing says what to update to',
          [
            'tagma update --head — a clean cut of HEAD, then a restart',
            'tagma update --tree — the tree as it stands, then a restart',
            'tagma update --back — the installation kept beside the one that stands, then a restart',
          ],
        );
      }
      const at = yield* CurrentInvocation;
      const url = baseUrl(at);
      const standing = yield* healthOrNone();
      if (standing === null && offer === 'back') return yield* steppedBackAlone(yield* InstalledChannel, o.json);
      if (standing === null)
        return refuse('server-not-up', `nothing answers at ${url}; the server runs the build`, ['tagma web — start it']);
      const noDoor = () =>
        refuse('no-update-door', `${url} offers no ${offer} update, so it would build and restart nothing`, [
          `tagma build --${offer} — then tagma restart`,
          'tagma status — the next installations offered here',
        ]);
      const before = yield* machineState({ ask, here });
      const next = before.server.next;
      if (![...next.offers, ...(next.back === null ? [] : [next.back])].some((one) => one.id === offer)) return noDoor();
      const leaving = before.server.pid;
      const restartId = before.restart.record?.id;
      const started = yield* installNext({ ask, here }, { offer, then: 'restart' }, o.json);
      if (!o.json) yield* Console.log(`updating from ${started.offer} ${started.target} — build output in ${started.log}`);
      const log = yield* serveLog(at);
      const local = boundHere(at, url);
      let announced: DirectoryHolder = null;
      let every = BUILD_ASKED_EVERY_MS;
      for (;;) {
        yield* Effect.sleep(every);
        const read = yield* Effect.result(machineState({ ask, here }));
        if (read._tag === 'Failure') {
          yield* Effect.logDebug('the restarting server did not answer', read.failure);
          every = ASKED_EVERY_MS;
          const saved = yield* local ? readStartup(join(dirname(log), RESTART_RECORD)) : startup();
          const failure =
            (saved.restart?.id !== restartId ? saved.restart?.failure : null) ??
            (saved.startup?.pid !== leaving ? saved.startup?.failure?.detail : null);
          if (failure != null) {
            return refuse('restart-failed', `${url} did not restart: ${failure}`, [log, started.log]);
          }
          const held = local ? dataDirectoryLocked(dirname(log)) : null;
          if (local && held === null && saved.restart?.underway !== true) {
            return refuse('server-not-up', `${url} does not answer, no process holds ${dirname(log)}, and no restart is under way`, [
              `${log} — what the successor printed, under the start marked "on restart"`,
              `${started.log} — the whole output of the build`,
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
        const ended = server.next.installed;
        const landed = ended?.since === started.since ? ended.build : null;
        if (
          server.pid !== leaving &&
          server.installation !== null &&
          server.installation.build === before.server.installation?.build &&
          server.installation.build !== landed
        ) {
          return refuse('restart-failed', `${url} came back on ${server.installation.build} instead of ${landed ?? started.target}`, [
            log,
            started.log,
          ]);
        }
        if (server.next.installing !== null && server.next.installing.since === started.since) continue;
        if (ended === null || ended.since !== started.since) {
          return refuse('build-unread', `${url} no longer answers for the build it started; its outcome is in the log`, [
            `${started.log} — the whole output of the build`,
          ]);
        }
        if (ended.outcome === 'failed') {
          return refuse('build-failed', `${ended.detail} (from ${ended.offer} ${ended.target}); nothing was restarted`, [
            `${ended.log} — the whole output of the build`,
          ]);
        }
        if (ended.outcome === 'stopped') {
          return refuse('build-stopped', `${ended.detail} (from ${ended.offer} ${ended.target}); nothing was restarted`, [
            `${ended.log} — what it printed before it stopped`,
          ]);
        }
        if (ended.restartRefused !== null) {
          return refuse('restart-refused', `${ended.build ?? 'the build'} landed, and the restart was refused: ${ended.restartRefused}`, [
            `${log} — what the successor printed, under the start marked "on restart"`,
            'tagma restart — ask again',
          ]);
        }
        if (server.pid === leaving) {
          every = ASKED_EVERY_MS;
          continue;
        }
        const mismatch = restartMismatch(server.installation?.build ?? null, ended.build ?? ended.target);
        if (mismatch !== null) return refuse('restart-failed', `${url} ${mismatch}`, [log, started.log]);
        if (o.json) return yield* print(ended, true);
        yield* Console.log(`updated ${url} to ${ended.build ?? ended.target} from ${ended.offer} ${ended.target}`);
        return;
      }
    }),
  ).pipe(
    Command.withDescription(
      'build from the checkout this Tagma was cut from and restart onto it: --head a clean cut, --tree as it stands; --back steps back',
    ),
    noting(`\`tagma build\` and \`tagma restart\` as one act the standing server carries: it runs the
build and, once the installation lands, restarts onto it the way \`tagma restart\`
does — the execution host and its terminals stand through it. A failed build
restarts nothing. \`--back\` makes the installation kept beside the one that
stands current again and restarts onto it. The chain runs in the server, so this
verb may be interrupted without stopping it; \`tagma status\` then says where it
stands.`),
  );
