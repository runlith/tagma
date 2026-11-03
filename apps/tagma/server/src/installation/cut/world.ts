import { closeSync, existsSync, openSync, readFileSync, readlinkSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Data, Effect, type Layer, Result, Schema } from 'effect';
import type { Processes } from '@runlith/execution-host/ProcessReader';
import type { Channel } from '../contract/wire/channel.js';
import { type FeedRelease, feedSchema } from '../contract/wire/feed.js';
import { portBlock, portsEnv } from '../contract/wire/ports.js';
import {
  CLI_ENTRY,
  INSTALL_FILE,
  RELEASE_INSIDE,
  RUNTIME_PART,
  SERVE_FLAGS,
  WHISPER_ENGINE_PART,
  dataDirectory,
} from '../contract/wire/layout.js';
import { releaseApplication } from '../contract/wire/manifest.js';
import { installationRootIn } from '../paths.js';
import { readStartup } from '../process/record.js';
import { RESTART_RECORD } from '../contract/wire/restart.js';
import { dataDirectoryLocked } from '../../platform/lock/holder.js';
import { CURRENT } from '../../platform/contract/wire/versions.js';
import { pidAlive } from '@runlith/utils/process';

const UNPACK = ['--no-xattrs', '--no-mac-metadata', '--no-acls', '--no-fflags', '--no-same-owner'];
const CODESIGN = '/usr/bin/codesign';
const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
const ASKED_EVERY_MS = 250;
const OFFSETS = Object.values(portBlock(0));
const PROJECT = 'trial';

export type World = {
  readonly channel: Channel;
  readonly dir: string;
  readonly env: Readonly<Record<string, string>>;
  readonly url: string;
  readonly installRoot: string;
  readonly data: string;
  readonly repo: string;
  readonly processes: Layer.Layer<Processes>;
};

const startupOf = (world: World) => Effect.runPromise(readStartup(join(world.data, RESTART_RECORD)).pipe(Effect.provide(world.processes)));

export type Ran = { readonly code: number; readonly out: string; readonly err: string };

export type Terminal = { readonly execution: string; readonly incarnation: number };

export type Terminals = { readonly pipes: Terminal; readonly pty: Terminal };

export type Beats = { readonly count: number; readonly trouble: string | null };

export type Waited = { readonly ms: number; readonly meanwhile: string | null };

export type Seen = {
  readonly serving: string | null;
  readonly current: string | null;
  readonly kept: string | null;
  readonly copy: string | null;
  readonly sound: { readonly present: boolean; readonly reason: string | null; readonly helper: string | null };
  readonly whisper: { readonly present: boolean; readonly reason: string | null };
  readonly terminals: { readonly pipes: string; readonly pty: string; readonly beats: Beats; readonly waited: Waited | null } | null;
};

const Health = Schema.Struct({
  ok: Schema.Literal(true),
  source: Schema.Struct({ installation: Schema.NullOr(Schema.Struct({ build: Schema.String })) }),
});
const Refused = Schema.Struct({ code: Schema.String, reason: Schema.String });
const Next = Schema.Struct({
  machine: Schema.Struct({
    server: Schema.Struct({
      next: Schema.Struct({
        offers: Schema.Array(Schema.Struct({ id: Schema.String, label: Schema.String })),
        readFrom: Schema.NullOr(Schema.String),
        issue: Schema.NullOr(Refused),
        installed: Schema.optional(Schema.NullOr(Schema.Struct({ outcome: Schema.String, detail: Schema.String }))),
      }),
    }),
  }),
});
const Started = Schema.Struct({ status: Schema.Literal('started') });
const Settled = Schema.Struct({
  operation: Schema.Struct({
    state: Schema.Struct({ execution: Schema.Struct({ execution: Schema.String, incarnation: Schema.Int }) }),
  }),
});
const Phase = Schema.Struct({ state: Schema.NullOr(Schema.Struct({ phase: Schema.String })) });
const Inventory = Schema.Struct({ notice: Schema.optional(Schema.NullOr(Schema.String)) });
const Bytes = Schema.Struct({
  range: Schema.Struct({ next: Schema.String, retainedFrom: Schema.String, durableThrough: Schema.String, gap: Schema.Boolean }),
  bytes: Schema.String,
});
const Availability = Schema.Struct({ _tag: Schema.String, reason: Schema.optional(Schema.String) });
const Sound = Schema.Struct({
  speech: Schema.Struct({ devices: Schema.Struct({ availability: Availability }), detector: Availability }),
});
const Carried = Schema.fromJsonString(Schema.Struct({ identity: Schema.Struct({ build: Schema.String }) }));
const encodeFeed = Schema.encodeSync(Schema.fromJsonString(feedSchema));

const reader =
  <S extends Schema.ConstraintDecoder<unknown>>(schema: S) =>
  (value: unknown): Result.Result<S['Type'], string> =>
    Result.mapError(Schema.decodeUnknownResult(schema)(value), (error) => error.message);

const readHealth = reader(Health);
const readRefused = reader(Refused);
const readNext = reader(Next);
const readStarted = reader(Started);
const readSettled = reader(Settled);
const readPhase = reader(Phase);
const readInventory = reader(Inventory);
const readBytes = reader(Bytes);
const readSound = reader(Sound);
const readCarried = reader(Carried);

const pause = (ms: number): Promise<void> => new Promise((wake) => setTimeout(wake, ms));

const free = (port: number): Promise<boolean> =>
  new Promise((answered) => {
    const probe = createServer();
    probe.once('error', () => answered(false));
    probe.listen({ port, host: '127.0.0.1', exclusive: true }, () => probe.close(() => answered(true)));
  });

const freePorts = async (): Promise<number | null> => {
  for (let base = 41_000 + Math.floor(Math.random() * 400) * 10; base < 49_000; base += 10) {
    if ((await Promise.all(OFFSETS.map((offset) => free(base + offset)))).every(Boolean)) return base;
  }
  return null;
};

export const said = (one: Ran): string => (one.err.trim() || one.out.trim()).split('\n').slice(-3).join(' ').slice(0, 400);

export const ran = async (world: World, argv: readonly string[], cwd = world.dir): Promise<Ran> => {
  const child = Bun.spawn([...argv], { cwd, env: { ...world.env }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { code, out, err };
};

export const whisperRuns = async (world: World): Promise<string | null> => {
  const engine = join(world.installRoot, CURRENT, WHISPER_ENGINE_PART);
  const asked = await ran(world, [engine]);
  return asked.out.includes('"code":"invocation"') ? null : `its Whisper engine ${engine} does not run: ${said(asked)}`;
};

export const cli = (world: World, ...args: string[]): Promise<Ran> => {
  const current = join(world.installRoot, CURRENT);
  return ran(world, [join(current, RUNTIME_PART), ...SERVE_FLAGS, join(current, CLI_ENTRY), ...args]);
};

export const openWorld = async (
  channel: Channel,
  scratch: string,
  processes: Layer.Layer<Processes>,
): Promise<Result.Result<World, string>> => {
  const port = await freePorts();
  if (port === null) return Result.fail('no four free loopback ports stand between 41000 and 49000 for a server of its own');
  const dir = await realpath(await mkdtemp(join(scratch, 'tagma-trial-')));
  const home = join(dir, 'home');
  const repo = join(dir, 'repo');
  await Promise.all([home, repo, join(dir, 'tmp')].map((at) => mkdir(at, { recursive: true })));
  const env: Record<string, string> = {
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    HOME: home,
    CFFIXED_USER_HOME: home,
    TMPDIR: `${join(dir, 'tmp')}/`,
    LANG: 'en_US.UTF-8',
    USER: process.env.USER ?? 'tagma',
    LOGNAME: process.env.LOGNAME ?? process.env.USER ?? 'tagma',
    SHELL: '/bin/sh',
    CLAUDE_CONFIG_DIR: join(home, '.claude'),
    CODEX_HOME: join(home, '.codex'),
    ...portsEnv(portBlock(port)),
  };
  return Result.succeed({
    channel,
    dir,
    env,
    url: `http://127.0.0.1:${port}`,
    installRoot: Result.getOrThrow(installationRootIn(channel, env)),
    data: dataDirectory(channel, env)!,
    repo,
    processes,
  });
};

export const unpacked = async (world: World, archive: string, into: string): Promise<Result.Result<string, string>> => {
  await mkdir(into, { recursive: true });
  const unpacking = await ran(world, ['/usr/bin/tar', '-xzf', archive, '-C', into, ...UNPACK]);
  if (unpacking.code !== 0) return Result.fail(`the archive does not unpack: ${said(unpacking)}`);
  const bundles = (await readdir(into)).filter((name) => name.endsWith('.app'));
  if (bundles.length !== 1) return Result.fail(`the archive holds ${bundles.length} applications at its root, and a release is one`);
  const app = join(into, bundles[0]!);
  const signed = await ran(world, [CODESIGN, '--verify', '--deep', '--strict', app]);
  return signed.code === 0 ? Result.succeed(app) : Result.fail(`${app} carries no valid signature, so nothing in it runs: ${said(signed)}`);
};

export const installedFrom = (world: World, app: string): Promise<Ran> => {
  const carried = join(app, RELEASE_INSIDE);
  return ran(world, [join(carried, RUNTIME_PART), ...SERVE_FLAGS, join(carried, CLI_ENTRY), 'install-from', carried]);
};

export const serving = async (world: World): Promise<string | null> => {
  const current = join(world.installRoot, CURRENT);
  const log = join(world.dir, 'serve.log');
  const sink = openSync(log, 'a');
  let server: Bun.Subprocess;
  try {
    server = Bun.spawn([join(current, RUNTIME_PART), ...SERVE_FLAGS, join(current, CLI_ENTRY), 'serve'], {
      cwd: world.dir,
      env: { ...world.env },
      stdin: 'ignore',
      stdout: sink,
      stderr: sink,
    });
  } finally {
    closeSync(sink);
  }
  for (;;) {
    const saved = await startupOf(world);
    if (saved.startup?.status === 'failed' && saved.startup.pid === server.pid)
      return `its server start failed: ${saved.startup.failure?.detail ?? saved.startup.phase}`;
    if (Result.isSuccess(await serves(world))) return null;
    if (server.exitCode !== null && dataDirectoryLocked(world.data) === null && saved.restart?.underway !== true)
      return `its server left with ${server.exitCode} before ${world.url} answered: ${(await readFile(log, 'utf8')).slice(-600)}`;
    await pause(ASKED_EVERY_MS);
  }
};

export const serves = async (world: World): Promise<Result.Result<string, string>> => {
  const answer = await fetch(`${world.url}/health`).catch((cause: unknown) => String(cause));
  if (typeof answer === 'string') return Result.fail(answer);
  if (!answer.ok) return Result.fail(`/health answers ${answer.status}`);
  const read = readHealth(await answer.json().catch((cause: unknown) => String(cause)));
  return Result.map(read, (health) => health.source.installation?.build ?? 'a server of no installation');
};

export const op = async (world: World, id: string, input: unknown, scoped = true): Promise<unknown> => {
  const answer = await fetch(`${world.url}/api/op/${id}${scoped ? `?project=${PROJECT}` : ''}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).catch((cause: unknown) => String(cause));
  if (typeof answer === 'string') return { code: 'unreached', reason: answer };
  return answer.json().catch(() => ({ code: 'unreadable', reason: `${id} answered ${answer.status} and no JSON` }));
};

const refusalOf = (answer: unknown): string => {
  const refused = readRefused(answer);
  return Result.isSuccess(refused)
    ? `${refused.success.code}: ${refused.success.reason}`
    : (JSON.stringify(answer) ?? 'nothing').slice(0, 400);
};

const BEAT = /beat (\d+) (\d+)\r?\n/gu;
const BEATING = `i=0; while :; do echo "beat $i $(date +%s)"; i=$((i+1)); sleep 0.2; done`;
const BEAT_LAG_S = 5;
const PAGE_BYTES = 65_536;

type Opened = { readonly transport: 'pipes' | 'pty'; readonly args: readonly string[]; readonly stdin?: 'ignore' };

const terminal = async (world: World, opened: Opened): Promise<Result.Result<Terminal, string>> => {
  const started = await op(world, 'start_terminal', {
    operationId: `trial-${opened.transport}`,
    cwd: world.repo,
    lifetime: 'held',
    program: '/bin/sh',
    label: `a ${opened.transport} terminal the update outlives`,
    ...opened,
  });
  const settled = readSettled(started);
  return Result.isSuccess(settled)
    ? Result.succeed(settled.success.operation.state.execution)
    : Result.fail(`its ${opened.transport} terminal did not start: ${refusalOf(started)}`);
};

const AWAITED_DOOR = 'opens its door';

const hostSettled = async (world: World): Promise<string | null> => {
  for (;;) {
    const answer = await op(world, 'read_terminals', {});
    const inventory = readInventory(answer);
    if (Result.isFailure(inventory)) return `its terminals did not read while its host came up: ${refusalOf(answer)}`;
    if (inventory.success.notice?.includes(AWAITED_DOOR) !== true) return null;
    await pause(ASKED_EVERY_MS);
  }
};

export const held = async (world: World): Promise<Result.Result<Terminals, string>> => {
  const born = await ran(world, ['/usr/bin/git', 'init', '-q'], world.repo);
  if (born.code !== 0) return Result.fail(`its project repository was not made: ${said(born)}`);
  const project = await op(world, 'add_project', { rootPath: world.repo, name: PROJECT, storage: 'stealth' }, false);
  if (Result.isSuccess(readRefused(project))) return Result.fail(`its project was not registered: ${refusalOf(project)}`);
  const settled = await hostSettled(world);
  if (settled !== null) return Result.fail(settled);
  const pipes = await terminal(world, { transport: 'pipes', args: ['-c', 'while :; do sleep 1; done'], stdin: 'ignore' });
  if (Result.isFailure(pipes)) return Result.fail(pipes.failure);
  const pty = await terminal(world, { transport: 'pty', args: ['-c', BEATING] });
  return Result.map(pty, (one) => ({ pipes: pipes.success, pty: one }));
};

const beatsOf = async (world: World, pty: Terminal): Promise<Beats> => {
  const asked = Math.floor(Date.now() / 1000);
  let offset = '0';
  let text = '';
  for (;;) {
    const answer = await op(world, 'read_terminal_bytes', { ...pty, stream: 'pty', offset, limit: PAGE_BYTES, positions: false });
    const read = readBytes(answer);
    if (Result.isFailure(read)) return { count: 0, trouble: `its pty record did not read from ${offset}: ${refusalOf(answer)}` };
    const { range, bytes } = read.success;
    if (range.gap || range.retainedFrom !== '0') {
      return { count: 0, trouble: `its pty record keeps from ${range.retainedFrom}${range.gap ? ` and has a gap at ${offset}` : ''}` };
    }
    text += Buffer.from(bytes, 'base64').toString('latin1');
    if (BigInt(range.next) >= BigInt(range.durableThrough) || range.next === offset) break;
    offset = range.next;
  }
  const beats = [...text.matchAll(BEAT)].map((match) => ({ at: Number(match[1]), time: Number(match[2]) }));
  const skipped = beats.findIndex((beat, at) => beat.at !== at);
  if (skipped >= 0) return { count: skipped, trouble: `its pty record reads beat ${beats[skipped]!.at} where beat ${skipped} stands` };
  const last = beats.at(-1);
  if (last === undefined) return { count: 0, trouble: `its pty record holds no beat in ${text.length} bytes` };
  return last.time + BEAT_LAG_S >= asked
    ? { count: beats.length, trouble: null }
    : { count: beats.length, trouble: `its pty record ends at a beat of ${asked - last.time} s ago` };
};

export const updated = async (world: World, offer: FeedRelease): Promise<string | null> => {
  const feed = join(world.dir, 'feed.json');
  await writeFile(feed, encodeFeed({ releases: [offer] }));
  const url = pathToFileURL(feed).href;
  const wrote = await op(world, 'write_setting', { key: 'release.feed', value: url });
  if (Result.isSuccess(readRefused(wrote))) return `its release feed could not be set: ${refusalOf(wrote)}`;
  let id: string | undefined;
  while (id === undefined) {
    const answer = await op(world, 'read_machine_state', {});
    const next = readNext(answer);
    if (Result.isFailure(next)) {
      const refusal = readRefused(answer);
      if (Result.isFailure(refusal) || refusal.success.code !== 'unreached')
        return `its machine state did not read while waiting for ${offer.release}: ${refusalOf(answer)}`;
      const saved = await startupOf(world);
      if (dataDirectoryLocked(world.data) === null && saved.restart?.underway !== true)
        return `no server answers at ${world.url}, no process holds ${world.data}, and no restart is under way`;
    } else {
      const frame = next.success.machine.server.next;
      const offered = frame.offers.find((one) => one.label === offer.release);
      if (frame.readFrom === url) {
        if (frame.issue !== null) return `its release feed could not be read: ${frame.issue.code}: ${frame.issue.reason}`;
        if (offered === undefined) return `its server checked ${url} and did not offer ${offer.release}`;
        id = offered.id;
      }
    }
    if (id === undefined) await pause(ASKED_EVERY_MS);
  }
  const before = await startupOf(world);
  const started = await op(world, 'install_next', { offer: id, then: 'restart' });
  if (Result.isFailure(readStarted(started))) return `its update to ${offer.release} did not start: ${refusalOf(started)}`;
  for (;;) {
    const saved = await startupOf(world);
    const failure =
      (saved.restart?.id !== before.restart?.id ? saved.restart?.failure : null) ??
      (saved.startup?.pid !== before.startup?.pid ? saved.startup?.failure?.detail : null);
    if (failure != null) return `its update to ${offer.release} failed: ${failure}`;
    const now = await serves(world);
    if (Result.isSuccess(now) && now.success === offer.release) return null;
    const next = readNext(await op(world, 'read_machine_state', {}));
    const ended = Result.map(next, (state) => state.machine.server.next.installed);
    if (Result.isSuccess(ended) && ended.success?.outcome === 'failed')
      return `its update to ${offer.release} failed: ${ended.success.detail}`;
    if (Result.isFailure(now) && dataDirectoryLocked(world.data) === null && saved.restart?.underway !== true)
      return `no server answers at ${world.url}, no process holds ${world.data}, and no restart is under way`;
    await pause(ASKED_EVERY_MS * 4);
  }
};

const buildIn = (root: string): string | null => {
  const at = join(root, INSTALL_FILE);
  if (!existsSync(at)) return null;
  const read = readCarried(readFileSync(at, 'utf8'));
  return Result.isSuccess(read) ? read.success.identity.build : `${at} does not read: ${read.failure}`;
};

export const carried = (app: string): string | null => buildIn(join(app, RELEASE_INSIDE));

type HelperProcess = { readonly pid: number; readonly path: string };

class HelpersUnreadable extends Data.TaggedError('HelpersUnreadable')<{ readonly message: string }> {}

const helpers = async (world: World): Promise<readonly HelperProcess[]> => {
  const listed = await ran(world, ['/bin/ps', '-axww', '-o', 'pid=,args=']);
  if (listed.code !== 0) throw new HelpersUnreadable({ message: `audio helper processes could not be read: ${said(listed)}` });
  const named = ` --data ${world.data}`;
  const found: HelperProcess[] = [];
  for (const line of listed.out.split('\n')) {
    const match = /^\s*(\d+)\s+(.*)$/u.exec(line);
    if (match === null) continue;
    const args = match[2]!;
    if (args.endsWith(named) && args.includes(' --socket ')) {
      found.push({ pid: Number(match[1]), path: args.slice(0, args.indexOf(' --socket ')) });
    }
  }
  return found;
};

const phaseOf = async (world: World, one: Terminal): Promise<string> => {
  const answer = await op(world, 'read_terminal', one);
  const phase = readPhase(answer);
  return Result.isSuccess(phase) ? (phase.success.state?.phase ?? 'not answered by its host') : `unread: ${refusalOf(answer)}`;
};

const terminalsOf = async (world: World, terminals: Terminals, waited: Waited | null): Promise<NonNullable<Seen['terminals']>> => ({
  pipes: await phaseOf(world, terminals.pipes),
  pty: await phaseOf(world, terminals.pty),
  beats: await beatsOf(world, terminals.pty),
  waited,
});

const readable = async (world: World, terminals: Terminals): Promise<Waited> => {
  const started = Date.now();
  let meanwhile: string | null = null;
  for (;;) {
    const answer = await op(world, 'read_terminal', terminals.pty);
    const phase = readPhase(answer);
    if (Result.isSuccess(phase) && phase.success.state !== null) return { ms: Date.now() - started, meanwhile };
    meanwhile = Result.isSuccess(phase) ? 'its host did not answer' : refusalOf(answer);
    if (Result.isSuccess(phase)) {
      const saved = await startupOf(world);
      if (dataDirectoryLocked(world.data) === null && saved.restart?.underway !== true) return { ms: Date.now() - started, meanwhile };
    } else {
      const refused = readRefused(answer);
      if (Result.isFailure(refused)) return { ms: Date.now() - started, meanwhile };
      const { code } = refused.success;
      if (code === 'unreached') {
        const saved = await startupOf(world);
        if (dataDirectoryLocked(world.data) === null && saved.restart?.underway !== true) return { ms: Date.now() - started, meanwhile };
      } else if (
        code !== 'terminal-host-closed' &&
        code !== 'terminal-unavailable-executions' &&
        code !== 'terminal-host-unavailable-unreachable'
      ) {
        return { ms: Date.now() - started, meanwhile };
      }
    }
    await pause(ASKED_EVERY_MS * 2);
  }
};

export const observedSettled = async (world: World, terminals: Terminals | null): Promise<Seen> =>
  observed(world, terminals, terminals === null ? null : await readable(world, terminals));

export const observed = async (world: World, terminals: Terminals | null, waited: Waited | null = null): Promise<Seen> => {
  const current = join(world.installRoot, CURRENT);
  const standing = existsSync(current) ? join(world.installRoot, readlinkSync(current)) : null;
  const sound = readSound(await op(world, 'speech_status', {}, false));
  const helper = (await helpers(world))[0];
  const serving = await serves(world);
  return {
    serving: Result.isSuccess(serving) ? serving.success : `nothing: ${serving.failure}`,
    current: standing === null ? null : buildIn(standing),
    kept: standing === null ? null : carried(releaseApplication(standing, world.channel.name)),
    copy: keptOf(world),
    sound: {
      present: Result.isSuccess(sound) && sound.success.speech.devices.availability._tag === 'present',
      reason: Result.isSuccess(sound)
        ? (sound.success.speech.devices.availability.reason ?? null)
        : `speech_status did not read: ${sound.failure}`,
      helper: helper === undefined ? null : relative(world.dir, helper.path),
    },
    whisper: {
      present: Result.isSuccess(sound) && sound.success.speech.detector._tag === 'present',
      reason: Result.isSuccess(sound) ? (sound.success.speech.detector.reason ?? null) : `speech_status did not read: ${sound.failure}`,
    },
    terminals: terminals === null ? null : await terminalsOf(world, terminals, waited),
  };
};

export const observedAfresh = async (world: World, terminals: Terminals | null): Promise<Seen> => {
  for (;;) {
    const running = await helpers(world);
    if (running.length === 0) break;
    while (running.some(({ pid }) => pidAlive(pid))) await pause(ASKED_EVERY_MS * 4);
  }
  return observedSettled(world, terminals);
};

export const keptOf = (world: World): string | null => {
  const current = join(world.installRoot, CURRENT);
  return existsSync(current)
    ? relative(world.dir, releaseApplication(join(world.installRoot, readlinkSync(current)), world.channel.name))
    : null;
};

const REGISTERED = /^path:\s+(.+?) \(0x[0-9a-f]+\)$/gmu;

const registeredUnder = async (world: World): Promise<readonly string[]> => {
  const dump = await new Response(Bun.spawn([LSREGISTER, '-dump'], { stdout: 'pipe', stderr: 'ignore' }).stdout).text();
  return [...dump.matchAll(REGISTERED)].map((match) => match[1]!).filter((path) => path.startsWith(`${world.dir}/`));
};

export const closed = async (world: World): Promise<string> => {
  const told: string[] = [];
  const quit = await cli(world, 'quit');
  told.push(`quit: exited ${quit.code} ${said(quit)}`);
  if (quit.code !== 0) {
    const pid = dataDirectoryLocked(world.data);
    if (typeof pid === 'number') {
      try {
        process.kill(pid, 'SIGTERM');
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') throw cause;
      }
      while (pidAlive(pid)) await pause(ASKED_EVERY_MS);
    }
    while (dataDirectoryLocked(world.data) !== null) await pause(ASKED_EVERY_MS);
    const shutdown = await cli(world, 'execution-host', 'shutdown', '--operation=release-trial');
    told.push(`execution host shutdown: exited ${shutdown.code} ${said(shutdown)}`);
  }
  const log = await readFile(join(world.dir, 'serve.log'), 'utf8').catch(() => '');
  await rm(world.dir, { recursive: true, force: true });
  const registered = await registeredUnder(world);
  for (const bundle of registered) await Bun.spawn([LSREGISTER, '-u', bundle], { stdout: 'ignore', stderr: 'ignore' }).exited;
  told.push(`LaunchServices forgot ${registered.length} applications of this world`, log);
  return told.join('\n');
};
