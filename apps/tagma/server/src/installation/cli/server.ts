import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Console, Clock, Effect, Option, Schema } from 'effect';
import { Command, Flag } from 'effect/cli';
import { provenanceLine } from '../../platform/contract/wire/provenance.js';
import { migrationLoadText } from '../../platform/contract/wire/migrationLoad.js';
import { HomeUnavailable } from '../contract/wire/home.js';
import { InstalledChannel } from '../contract/service/channel.js';
import { SERVE_FLAGS, serveLogPath, dataDirectory } from '../contract/wire/layout.js';
import { dataDirectoryLocked } from '../../platform/lock/holder.js';
import { refuse, noting, CurrentInvocation, type Invocation, print } from '../../platform/cli/verb.js';
import { type Answered, renderMachine, renderStartup, renderStatus } from '../voice/status.js';
import { readStartup } from '../process/record.js';
import { RESTART_RECORD } from '../contract/wire/restart.js';
import type { MachineState } from '../contract/wire/machine.js';
import { INSTALLATION_OPERATIONS } from '../contract/wire/operations.js';
import type { Restart } from '../contract/wire/source.js';
import type { ServerCli } from './port.js';
import { awaitRestart, awaitStart, comingUp, requestRestart } from '../process/serverStart.js';
import { activeElsewhere, activeHolder } from '../setup/active.js';
import { stopUnheld, switchFrom } from '../setup/switch.js';
import { channelActive, junctionDirectory, readActive } from '../contract/wire/junction.js';
import { QUIT_WORDS } from '../contract/wire/words.js';
import { processStateSchema } from '../contract/wire/probe.js';
import { readProcessState } from '../process/probe.js';
import type { Processes } from '@runlith/execution-host/ProcessReader';

export const serveLog = (at: Invocation): Effect.Effect<string, HomeUnavailable, InstalledChannel> =>
  Effect.flatMap(InstalledChannel, (channel) => {
    const log = serveLogPath(channel, at.env);
    return log === null ? Effect.fail(new HomeUnavailable({ variable: 'TAGMA_DATABASE_PATH' })) : Effect.succeed(log);
  });

export const entryRoot = (at: Invocation): string => resolve(dirname(at.entry), '..', '..');

export type Operating = Pick<ServerCli, 'ask' | 'here'>;

const readMachineState = Schema.decodeUnknownResult(INSTALLATION_OPERATIONS.read_machine_state.answer);
const readRestart = Schema.decodeUnknownResult(INSTALLATION_OPERATIONS.restart_server.answer);

export const machineState = ({ ask, here }: Operating): Effect.Effect<MachineState, unknown> =>
  ask((door, at) => door.operations.perform({ params: { id: 'read_machine_state' }, query: here(at), headers: {}, payload: {} })).pipe(
    Effect.flatMap((answered) => {
      const read = readMachineState(answered);
      if (read._tag !== 'Success' || read.success.status !== 'read') {
        return Effect.fail(new Error('read_machine_state answered outside its read shape'));
      }
      return Effect.succeed((read.success as { readonly machine: MachineState }).machine);
    }),
  );

const restartServer = ({ ask, here }: Operating): Effect.Effect<Restart, unknown> =>
  ask((door, at) => door.operations.perform({ params: { id: 'restart_server' }, query: here(at), headers: {}, payload: {} })).pipe(
    Effect.flatMap((answered) => {
      const read = readRestart(answered);
      if (read._tag !== 'Success' || read.success.status !== 'restarting') {
        return Effect.fail(new Error('restart_server answered outside its restarting shape'));
      }
      return Effect.succeed((read.success as { readonly restart: Restart }).restart);
    }),
  );

const startupWords = (log: string, url: string): Effect.Effect<readonly string[], never, Processes> =>
  Effect.map(readStartup(join(dirname(log), RESTART_RECORD)), (saved) =>
    saved.startup === null && saved.issue === null ? [] : [renderStartup(saved, url)],
  );

type Standing = {
  readonly url: string;
  readonly answered: Answered;
  readonly started: boolean;
};

const standingLine = (answered: Answered): string => {
  const { source } = answered.health;
  return source.installation !== null
    ? `installation ${source.installation.build}`
    : source.cut !== null
      ? provenanceLine(source.cut)
      : `tagma ${answered.health.version}`;
};

export const ensureServer = Effect.fnUntraced(function* ({
  baseUrl,
  boundAddress,
  boundHere,
  healthOrNone,
}: ServerCli): Effect.fn.Return<Standing, HomeUnavailable, InstalledChannel | Processes> {
  const at = yield* CurrentInvocation;
  const channel = yield* InstalledChannel;
  const { command } = channel;
  const url = baseUrl(at);
  const adopted = yield* healthOrNone();
  if (adopted !== null) return { url, answered: adopted, started: false };
  const other = activeElsewhere(channel, at.env);
  if (other !== null) {
    const said = channelActive(other, channel);
    return refuse('channel-active', said.reason, said.unblock);
  }
  if (!boundHere(at, url)) {
    return refuse('server-elsewhere', `nothing answers at ${url}, and ${command} serve here binds ${boundAddress(at)}`, [
      `${command} serve — on the machine ${url} names, where a server may then answer`,
      `unset TAGMA_SERVER_URL — then this verb starts a server at ${boundAddress(at)}`,
    ]);
  }
  const log = yield* serveLog(at);
  const data = dirname(log);
  const stamp = new Date(yield* Clock.currentTimeMillis).toISOString();
  const child = yield* Effect.sync(() => {
    mkdirSync(data, { recursive: true });
    const sink = openSync(log, 'a');
    writeSync(sink, `\n=== tagma serve started ${stamp}, asked by pid ${process.pid} ===\n`);
    const spawned = Bun.spawn([process.execPath, ...SERVE_FLAGS, at.entry, 'serve'], {
      cwd: at.cwd,
      env: at.env,
      stdin: 'ignore',
      stdout: sink,
      stderr: sink,
      detached: true,
    });
    closeSync(sink);
    spawned.unref();
    return spawned;
  });
  const outcome = yield* awaitStart(
    child,
    healthOrNone(),
    () => dataDirectoryLocked(data),
    readStartup(join(data, RESTART_RECORD)),
    comingUp(url, log),
  );
  if (outcome._tag !== 'Answered') {
    const why =
      outcome._tag === 'Failed'
        ? `the server start failed: ${outcome.detail}`
        : outcome._tag === 'Signalled'
          ? `the server started here was killed by ${outcome.signal} before ${url} answered`
          : `the server started here left with ${outcome.code} before ${url} answered`;
    return refuse('server-not-up', why, [
      ...(yield* startupWords(log, url)),
      `${log} — what it printed, under the start of ${stamp}`,
      `${command} serve — start it in this terminal and read what it says`,
    ]);
  }
  return { url, answered: outcome.answered, started: outcome.raised };
});

export const saidServer = Effect.fnUntraced(function* (standing: Standing) {
  yield* Console.log(`${standing.started ? 'started' : 'adopted'} ${standing.url} — ${standingLine(standing.answered)}`);
  if (standing.started) yield* Console.log(`its output goes to ${yield* serveLog(yield* CurrentInvocation)}`);
  const newer = newerStanding(standing.answered);
  if (newer !== null)
    yield* Console.log(`installation ${newer} stands on this machine; ${(yield* InstalledChannel).command} restart brings it up`);
});

const newerStanding = (answered: Answered): string | null => {
  const { source, standing } = answered.health;
  return source.installation !== null && standing !== null && standing.build !== source.installation.build ? standing.build : null;
};

const OPENER = process.platform === 'darwin' ? 'open' : 'xdg-open';

export const opened = Effect.fnUntraced(function* (args: readonly string[], what: string): Effect.fn.Return<void> {
  const spawned = yield* Effect.result(
    Effect.try({
      try: () => Bun.spawn([OPENER, ...args], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }),
      catch: (error) => String(error),
    }),
  );
  if (spawned._tag === 'Failure') {
    return refuse('not-opened', `${OPENER} would not run: ${spawned.failure}`, [`${what} — open it yourself`]);
  }
  const status = yield* Effect.promise(() => spawned.success.exited);
  if (status !== 0) {
    return refuse('not-opened', `${OPENER} left with ${status} and did not open ${what}`, [`${what} — open it yourself`]);
  }
});

export const opening = Flag.Boolean('open').pipe(
  Flag.withDescription('open the client; --no-open ensures the server and prints what it would have opened'),
  Flag.withDefault(true),
);

export const json = Flag.Boolean('json').pipe(Flag.withDescription('machine-readable output'), Flag.withDefault(false));
export const project = Flag.String('project').pipe(
  Flag.optional,
  Flag.withMetavar('name|id'),
  Flag.withDescription('defaults to the project whose root contains the cwd'),
);
export const optional = <A>(value: Option.Option<A>): A | undefined => Option.getOrUndefined(value);

export const restart = (cli: ServerCli) =>
  Command.make('restart', {}, () =>
    Effect.gen(function* () {
      const { baseUrl, boundHere, healthOrNone } = cli;
      const at = yield* CurrentInvocation;
      const url = baseUrl(at);
      const standing = yield* healthOrNone();
      if (standing === null) {
        yield* saidServer(yield* ensureServer(cli));
        return;
      }
      const before = yield* machineState(cli);
      const leaving = before.server.pid;
      const log = yield* serveLog(at);
      const local = boundHere(at, url);
      const progress = local ? readStartup(join(dirname(log), RESTART_RECORD)) : cli.startup();
      const asked = yield* requestRestart(
        restartServer(cli),
        yield* progress,
        progress,
        local ? () => dataDirectoryLocked(dirname(log)) : null,
      );
      if (asked?.heavy !== undefined) yield* Console.log(migrationLoadText(asked.heavy));
      const expected =
        asked === null
          ? before.server.installation === null
            ? null
            : (before.server.waiting ?? before.server.installation).build
          : asked.successor._tag === 'Installation'
            ? asked.successor.build
            : null;
      const outcome = yield* awaitRestart(
        machineState(cli).pipe(
          Effect.matchEffect({
            onFailure: (failure) => Effect.as(Effect.logDebug('the restarting server did not answer', failure), null),
            onSuccess: (state) => Effect.succeed(state),
          }),
        ),
        local ? () => dataDirectoryLocked(dirname(log)) : null,
        progress,
        {
          isSuccessor: (state) => state.server.pid !== leaving,
          build: (state) => state.server.installation?.build ?? null,
          expected,
        },
        local ? comingUp(url, log) : () => Effect.void,
      );
      if (outcome._tag === 'Failed') {
        return refuse('restart-failed', `${url} did not restart: ${outcome.detail}`, [
          `${log} — what the server printed on the way out and during its start`,
        ]);
      }
      if (outcome._tag === 'Silent') {
        return refuse('server-not-up', `${url} does not answer, no process holds ${dirname(log)}, and no restart is under way`, [
          ...(yield* startupWords(log, url)),
          `${log} — what the successor printed, under the start marked "on restart"`,
          `${(yield* InstalledChannel).command} serve — start it in this terminal and read what it says`,
        ]);
      }
      const server = outcome.answered.server;
      yield* Console.log(
        `restarted ${url} — ${server.installation === null ? `pid ${server.pid}` : `installation ${server.installation.build}`}`,
      );
      const previous = asked?.leaving ?? before.server.installation;
      if (previous !== null && previous.build !== expected) yield* Console.log(`from installation ${previous.build}`);
    }),
  ).pipe(
    Command.withDescription('ask the standing server to come up again as the installation that stands'),
    noting(`The server ends itself the ordered way — every writer closed, the data directory
released — and then starts what stands: an installed server the installation
\`current\` names, which is how a build just landed comes up; a server running a
checkout, that checkout again. What it printed on the way out and what the
successor prints both land in the server log, each start framed. With nothing
answering at the address, a server is started as \`tagma web\` would start one.
Executions in the host outlive the server: when the successor brings another
host build, the host's logic moves to it, and every terminal and command keeps
its process.`),
  );

const starting = Flag.Boolean('start').pipe(
  Flag.withDescription('start this Tagma once the other left; --no-start leaves the start to the window'),
  Flag.withDefault(true),
);

export const switching = (cli: ServerCli) =>
  Command.make('switch', { start: starting }, ({ start }) =>
    Effect.gen(function* () {
      const at = yield* CurrentInvocation;
      const channel = yield* InstalledChannel;
      const junction = junctionDirectory(at.env);
      const saved = junction === null ? null : readActive(junction);
      const holder = activeElsewhere(channel, at.env) ?? (saved?.chain !== undefined && saved.channel !== channel.id ? saved : null);
      if (holder !== null) {
        const switched = yield* switchFrom(holder, at.env).pipe(
          Effect.catchTag('SwitchRefused', (refused) => Effect.sync(() => refuse(refused.code, refused.reason, refused.unblock))),
        );
        yield* Console.log(switched.killed ? `${switched.from} did not leave in time and was killed` : `${switched.from} left`);
        if (switched.host !== '') yield* Console.log(switched.host);
      }
      if (start) yield* saidServer(yield* ensureServer(cli));
    }),
  ).pipe(
    Command.withDescription('end the Tagma that runs on this Mac and bring this one up in its place'),
    noting(`One Tagma runs on a Mac at a time. The one running leaves the way quitting
ends it — its threads stop, its execution host ends with every terminal and
command it runs — and this one starts and takes the entry point that hooks
and MCP servers reach.`),
  );

export const processState = Command.make('process-state', { data: Flag.String('data') }, ({ data }) =>
  Effect.gen(function* () {
    const at = yield* CurrentInvocation;
    const state = yield* readProcessState(data, at.env).pipe(
      Effect.catchTag('ProcessStateUnproven', (failure) =>
        Effect.sync(() => refuse('process-unproven', failure.detail, ['repair this copy of Tagma, then try again'])),
      ),
    );
    yield* Schema.encodeUnknownEffect(processStateSchema)(state).pipe(Effect.flatMap((answer) => print(answer, true)));
  }),
);

export const quitting = Command.make('quit', { json }, (o) =>
  Effect.gen(function* () {
    const at = yield* CurrentInvocation;
    const channel = yield* InstalledChannel;
    const junction = junctionDirectory(at.env);
    const saved = junction === null ? null : readActive(junction);
    const holder = junction === null ? null : (activeHolder(junction) ?? (saved?.chain !== undefined ? saved : null));
    if (holder !== null && holder !== 'unnamed' && holder.channel !== channel.id) {
      return yield* o.json ? print({ stopped: false }, true) : Console.log(`${channel.name} is not running`);
    }
    const data = dataDirectory(channel, at.env);
    const stopping = holder === null ? (data === null ? Effect.succeed(null) : stopUnheld(data, channel.name)) : switchFrom(holder, at.env);
    const stopped = yield* stopping.pipe(
      Effect.catchTag('SwitchRefused', (refused) =>
        Effect.sync(() => refuse(refused.code, refused.reason, refused.unblock, QUIT_WORDS[refused.code])),
      ),
    );
    if (stopped === null) return yield* o.json ? print({ stopped: false }, true) : Console.log(`${channel.name} is not running`);
    if (o.json) return yield* print({ stopped: true, host: stopped.host, killed: stopped.killed }, true);
    yield* Console.log(`${stopped.from} ${stopped.killed ? 'did not leave in time and was killed' : 'stopped'}; ${stopped.host}`);
  }),
).pipe(
  Command.withDescription('stop this Tagma: the server leaves and its execution host ends with every terminal and command it runs'),
  noting(`The window's Quit and Stop Tagma end Tagma through this verb. The server leaves
the way a signal ends it — every writer closed, the data directory released — and
then the execution host ends with every terminal and command it holds. A server
still running 90 seconds after the signal is killed, and the answer says so. With
nothing running, it says so and succeeds.`),
);

export const status = ({ ask, baseUrl, boundHere, here, health, healthOrNone }: ServerCli) =>
  Command.make(
    'status',
    {
      json,
      details: Flag.Boolean('details').pipe(Flag.withDefault(false)),
    },
    ({ json, details }) =>
      Effect.gen(function* () {
        const at = yield* CurrentInvocation;
        const url = baseUrl(at);
        let row = yield* healthOrNone();
        if (row === null && boundHere(at, url)) {
          const saved = yield* readStartup(join(dirname(yield* serveLog(at)), RESTART_RECORD));
          if (saved.startup !== null || saved.issue !== null)
            return json ? yield* print({ ready: false, ...saved }, true) : yield* Console.log(renderStartup(saved, url));
        }
        if (row === null) row = yield* health();
        const standing = yield* Effect.result(machineState({ ask, here }));
        if (standing._tag === 'Failure') {
          yield* Effect.logDebug('the machine state was not read', standing.failure);
          return json ? yield* print(row, true) : yield* Console.log(renderStatus(row, url));
        }
        if (json) return yield* print({ health: row.health, standing: standing.success }, true);
        yield* Console.log(renderMachine(standing.success, url));
        if (details) yield* Console.log(renderStatus(row, url));
      }),
  ).pipe(Command.withDescription('where the server and its execution host stand'));
