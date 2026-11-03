import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Context, Effect, Layer, Schema } from 'effect';
import { Processes } from '@runlith/execution-host/ProcessReader';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { gitLayer } from '@runlith/git/Git';
import { databasePath, installationRoot, launcherPath } from '../installation/paths.js';
import {
  ASKED_EVERY_MS,
  BUILD_HOME_ENV,
  CLI_ENTRY,
  RUNTIME_PART,
  SERVE_FLAGS,
  serveLogPath,
} from '../installation/contract/wire/layout.js';
import { CURRENT } from '../platform/contract/wire/versions.js';
import { refusalLines } from '@runlith/agent/tool/refusal';
import { knownAnswer } from '../platform/contract/wire/operation.js';
import { REGISTRY_OPERATIONS } from '../graph/contract/wire/operations/registry.js';
import { processInvocation } from '../platform/cli/verb.js';
import { ACT_VARIABLE, GRANT_VARIABLE, SESSION_TOKEN_VARIABLE, TERMINAL_VARIABLE } from '../platform/contract/service/credentials.js';
import { dataDirectoryLocked } from '../platform/lock/holder.js';
import { LOCK_FILE, type DirectoryHolder } from '../platform/contract/wire/lock.js';
import { answeredHere, besideConflict, besideHome, besidePort, besideRoot } from './beside.js';
import { besideEnv } from '../installation/contract/wire/beside.js';
import { portBlock } from '../installation/contract/wire/ports.js';
import type { Composition } from './descriptor.js';
import { releaseBeside } from './release.js';
import type { CutServer, HealthAnswer, InstanceHosts } from './port.js';
import { awaitStart, comingUp } from '../installation/process/serverStart.js';
import { ServerLaunch } from '../installation/process/launch.js';
import { readStartup } from '../installation/process/record.js';
import { RESTART_RECORD } from '../installation/contract/wire/restart.js';
import { pidAlive } from '@runlith/utils/process';

const USAGE = 'bun run tagma:try [--release] [--stop | --status] [--port <n>] [--root <dir>] [--no-project] [--json]';

const spawning = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));

const refuse: (json: boolean, code: string, reason: string, unblock: string[]) => never = (json, code, reason, unblock) => {
  if (json) console.log(JSON.stringify({ code, reason, unblock }));
  else console.error(refusalLines({ code, reason, unblock }).join('\n'));
  process.exit(2);
};

const print = (json: boolean, value: Record<string, unknown>, lines: string[]): void => {
  if (json) console.log(JSON.stringify(value, null, 2));
  else for (const line of lines) console.log(line);
};

export const tryout = (
  server: CutServer,
  hosts: InstanceHosts,
  given: readonly string[],
  sessionVariables: readonly string[],
  composition: Composition,
): Effect.Effect<void> => {
  const args = [...given];

  const valued = (name: string): string | undefined => {
    const at = args.indexOf(name);
    if (at < 0) return undefined;
    const value = args[at + 1];
    if (value === undefined || value.startsWith('--')) {
      refuse(false, 'no-value', `${name} names a value, and none was given`, [USAGE]);
    }
    args.splice(at, 2);
    return value;
  };

  const flagged = (name: string): boolean => {
    const at = args.indexOf(name);
    if (at < 0) return false;
    args.splice(at, 1);
    return true;
  };

  const rootGiven = valued('--root');
  const portGiven = valued('--port');
  const json = flagged('--json');
  const wantsStop = flagged('--stop');
  const wantsStatus = flagged('--status');
  const noProject = flagged('--no-project');
  if (args.length > 0) refuse(json, 'unknown-flag', `${args.join(' ')} is not a flag of this command`, [USAGE]);
  if (wantsStop && wantsStatus) {
    refuse(json, 'two-acts', 'stopping it and reading where it stands are two acts, and this command runs one', [
      'bun run tagma:try --stop',
      'bun run tagma:try --status',
    ]);
  }

  const { channel } = composition;
  const home = process.env.HOME?.trim();
  if (!home && rootGiven === undefined) {
    refuse(json, 'no-home', 'HOME names nowhere to stand a second Tagma, and no --root was given', ['bun run tagma:try --root <dir>']);
  }
  const root = rootGiven === undefined ? besideRoot(channel, home as string) : resolve(rootGiven);
  const port = portGiven === undefined ? besidePort(channel) : Number(portGiven);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    refuse(json, 'bad-port', `${portGiven} is not a port`, [`bun run tagma:try --port ${besidePort(channel)}`]);
  }

  const collides = besideConflict(root, process.env);
  if (collides !== null) {
    refuse(json, 'root-is-the-working-one', `${root} is the working Tagma's own ${collides}, and a second one may not stand in it`, [
      `bun run tagma:try --root ${besideRoot(channel, home ?? '~')} — a root of its own`,
    ]);
  }

  for (const [name, value] of Object.entries(besideEnv(root, port))) process.env[name] = value;
  delete process.env.TAGMA_SERVER_URL;

  const world = { ...process.env } as Record<string, string>;
  for (const name of [ACT_VARIABLE, GRANT_VARIABLE, SESSION_TOKEN_VARIABLE, TERMINAL_VARIABLE, ...sessionVariables]) delete world[name];
  if (home) world[BUILD_HOME_ENV] = process.env[BUILD_HOME_ENV] ?? home;
  world.HOME = besideHome(root);
  mkdirSync(world.HOME, { recursive: true });

  const database = databasePath(channel);
  const dataDirectory = dirname(database);
  const installRoot = installationRoot(channel);
  const log = serveLogPath(channel, process.env);
  if (log === null) refuse(json, 'no-home', 'nowhere to keep the output of a server standing beside', [USAGE]);
  const url = server.baseUrl(processInvocation());
  const holder = (): DirectoryHolder => dataDirectoryLocked(dataDirectory);

  const buildOf = (answered: HealthAnswer): string => answered.health.source.installation?.build ?? `tagma ${answered.health.version}`;

  const probe: Effect.Effect<HealthAnswer | null> = Effect.map(server.healthOrNone(), (answered) =>
    answeredHere(answered, database) ? answered : null,
  );

  const foreign = Effect.map(server.healthOrNone(), (answered) =>
    answered === null || answeredHere(answered, database) ? null : answered.health.database,
  );

  const pagePort = portBlock(port).artifact;
  const pagesHeld = Effect.gen(function* () {
    const asked = yield* Effect.result(
      Effect.tryPromise((signal) => fetch(`http://127.0.0.1:${pagePort}/`, { signal })).pipe(Effect.timeout(ASKED_EVERY_MS * 20)),
    );
    if (asked._tag === 'Success') return true;
    return asked.failure._tag === 'TimeoutError';
  });

  const quieted = Effect.fnUntraced(function* (pid: number | 'unnamed') {
    if (pid === 'unnamed')
      return refuse(json, 'server-unnamed', `a process holds ${dataDirectory}, but its pid is not known`, [
        `lsof ${join(dataDirectory, LOCK_FILE)} — identify the process and stop it before trying again`,
      ]);
    const signalled = yield* Effect.try({
      try: () => process.kill(pid, 'SIGTERM'),
      catch: (error) => (error as NodeJS.ErrnoException).code ?? String(error),
    }).pipe(Effect.result);
    if (signalled._tag === 'Failure' && signalled.failure !== 'ESRCH') {
      refuse(json, 'not-signalled', `pid ${pid} holds ${dataDirectory} and would not take the signal (${signalled.failure})`, [
        `kill -9 ${pid} — end it by hand`,
      ]);
    }
    while (pidAlive(pid) || holder() !== null || (yield* probe) !== null) {
      yield* Effect.sleep(ASKED_EVERY_MS);
    }
  });

  const hostsLeft: Effect.Effect<void> = Effect.gen(function* () {
    const staying = yield* hosts.staying(database);
    if (staying.length === 0) return;
    const holders = staying.flatMap((host) => host.holders);
    refuse(
      json,
      'host-stayed',
      `the execution host of ${root} could not be observed leaving: ${staying
        .map((host) => `${host.state} (${host.holders.length > 0 ? `pid ${host.holders.join(', ')}` : host.detail})`)
        .join('; ')}`,
      holders.length > 0
        ? [`kill ${holders.join(' ')} — end it by hand`]
        : staying.map((host) => `lsof ${host.state}/writer.lock — who holds it`),
    );
  });

  const ran = async (
    argv: readonly string[],
    cwd?: string,
  ): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> => {
    const child = Bun.spawn([...argv], { cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', env: world });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { code, stdout, stderr };
  };

  const checkoutRoot = async (source: string): Promise<string | null> => {
    const read = await ran(['git', 'rev-parse', '--show-toplevel'], source);
    const toplevel = read.code === 0 ? read.stdout.trim() : '';
    return toplevel === '' ? null : toplevel;
  };

  const firstLine = (text: string): string => (text.split('\n').find((line) => line.trim() !== '') ?? '').slice(0, 200);

  type Registered =
    | { readonly _tag: 'Registered'; readonly root: string }
    | { readonly _tag: 'Already'; readonly root: string }
    | { readonly _tag: 'Refused'; readonly root: string; readonly said: string }
    | { readonly _tag: 'Skipped' };

  const readProject = Schema.decodeUnknownResult(Schema.fromJsonString(knownAnswer(REGISTRY_OPERATIONS.read_project.answer)));

  const registerCheckout = async (runtime: string, entry: string, checkout: string | null): Promise<Registered> => {
    if (noProject || checkout === null) return { _tag: 'Skipped' };
    const read = await ran([runtime, entry, 'op', 'read_project', '--json', '{}'], checkout);
    if (read.code !== 0) return { _tag: 'Refused', root: checkout, said: firstLine(read.stderr) || firstLine(read.stdout) };
    const decoded = readProject(read.stdout);
    if (decoded._tag === 'Failure') return { _tag: 'Refused', root: checkout, said: decoded.failure.message };
    if (decoded.success.project !== null) return { _tag: 'Already', root: checkout };
    const added = await ran([runtime, entry, 'project', 'add', checkout, '--storage', 'stealth', '--json']);
    if (added.code === 0) return { _tag: 'Registered', root: checkout };
    return { _tag: 'Refused', root: checkout, said: firstLine(added.stderr) || firstLine(added.stdout) };
  };

  const registeredLines = (registered: Registered): string[] => {
    switch (registered._tag) {
      case 'Registered':
        return [`registered ${registered.root} as stealth: its graph files stand under ${root}, none in the checkout`];
      case 'Already':
        return [`${registered.root} already stands registered here, from an earlier run`];
      case 'Refused':
        return [
          `${registered.root} was not registered here — it said: ${registered.said}`,
          `tagma project add ${registered.root} --storage stealth — through ${join(installRoot, CURRENT, CLI_ENTRY)}`,
        ];
      case 'Skipped':
        return [];
    }
  };

  const stopping = Effect.gen(function* () {
    const pid = holder();
    if (pid !== null) yield* quieted(pid);
    yield* hostsLeft;
    if (pid === null) {
      print(json, { stopped: null, url, root }, [`nothing stands beside: no process holds ${dataDirectory}`]);
      return;
    }
    print(json, { stopped: pid, url, root }, [`stopped pid ${pid} and its execution host — ${url} is quiet, and ${root} stands as it was`]);
  });

  const reading = Effect.gen(function* () {
    const answered = yield* probe;
    const other = answered === null ? yield* foreign : null;
    print(
      json,
      { url, root, standing: answered === null ? null : buildOf(answered), foreign: other, holder: holder() },
      answered !== null
        ? [`${url} — ${buildOf(answered)}`, `its world stands in ${root}`]
        : other === null
          ? [`nothing answers at ${url}; bun run tagma:try brings one up`]
          : [`${url} answers, but on ${other} — that is not this root's server`, `bun run tagma:try --port <n> — somewhere of its own`],
    );
  });

  const standing = Effect.gen(function* () {
    const other = yield* foreign;
    if (other !== null) {
      refuse(json, 'port-taken', `${url} already answers, on ${other} — this command would not be talking to its own server`, [
        `bun run tagma:try --port <n> — an address nothing holds`,
      ]);
    }
    if (holder() === null && (yield* pagesHeld)) {
      refuse(json, 'pages-taken', `something already answers on ${pagePort}, where this server's pages would stand`, [
        `bun run tagma:try --port <n> — its pages stand one above whatever port it serves`,
      ]);
    }
    const cut = yield* Effect.result(
      releaseBeside(installRoot, launcherPath(channel), composition, besideEnv(root, port)).pipe(
        Effect.provide(Layer.mergeAll(gitLayer.pipe(Layer.provide(spawning)), spawning, BunFileSystem.layer)),
      ),
    );
    if (cut._tag === 'Failure') {
      return refuse(json, 'cut-failed', `${cut.failure.step}: ${cut.failure.detail}`, [
        ...cut.failure.unblock,
        ...(cut.failure.log === '' ? [] : [`${cut.failure.log} — the whole output of every step`]),
      ]);
    }
    const landed = cut.success;
    const standingPid = holder();
    if (standingPid !== null) yield* quieted(standingPid);
    yield* hostsLeft;

    const runtime = join(installRoot, CURRENT, RUNTIME_PART);
    const entry = join(installRoot, CURRENT, CLI_ENTRY);
    const processes = Context.get(yield* Layer.build(composition.processes), Processes);
    const launch = yield* Effect.acquireRelease(
      Effect.sync(() => new ServerLaunch([runtime, ...SERVE_FLAGS, entry, 'serve'], world, log, processes)),
      (started) => Effect.promise(() => started.stop()),
    );
    const outcome = yield* awaitStart(
      launch.initial,
      probe,
      holder,
      readStartup(join(dataDirectory, RESTART_RECORD)),
      comingUp(url, log),
    ).pipe(Effect.provideService(Processes, processes));
    if (outcome._tag !== 'Answered') {
      const why =
        outcome._tag === 'Failed'
          ? `the server start failed: ${outcome.detail}`
          : outcome._tag === 'Signalled'
            ? `the server was killed by ${outcome.signal} before ${url} answered`
            : `the server left with ${outcome.code} before ${url} answered`;
      refuse(json, 'server-not-up', why, [`${log} — what it printed, under the start of ${launch.startedAt}`]);
    }
    const registered = yield* Effect.promise(async () => registerCheckout(runtime, entry, await checkoutRoot(composition.roots.server)));
    print(
      json,
      {
        build: landed.manifest.identity.build,
        version: landed.version,
        root,
        installRoot,
        database,
        url,
        log,
        registered,
      },
      [
        `${landed.manifest.identity.build} — ${landed.manifest.parts.length} parts in ${landed.root}`,
        `serving ${url} on a database of its own: ${database}`,
        `its output goes to ${log}`,
        ...registeredLines(registered),
        'the installation that runs is untouched: its current, its launcher, its database and your PATH stand as they were',
        'stop this terminal or bun run tagma:try --stop — end this one; bun run tagma:try --status — where it stands',
      ],
    );
    process.exitCode = yield* Effect.promise(() => launch.exited);
  }).pipe(Effect.scoped);

  return wantsStop ? stopping : wantsStatus ? reading : standing;
};
