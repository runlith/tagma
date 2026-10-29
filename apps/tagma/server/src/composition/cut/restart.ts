import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORLD_COMMAND, dataDirectory, hostBinary, installationsRoot } from '../../installation/contract/wire/layout.js';
import { worldDirectory } from '../../installation/setup/launcher.js';
import { refusalLines } from '@runlith/agent/tool/refusal';
import { TAGMA_APP_ENVIRONMENT } from '../../tagma-apps/contract/wire/environment.js';
import { CHANNEL } from '../developer/channel.js';

type Running = { readonly pid: number; readonly ppid: number; readonly command: string };

const KEPT = ['HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'SSH_AUTH_SOCK'] as const;
const PATH_MARK = '__tagma_login_path__';
const LOGIN_MS = 15_000;
const QUIT_MS = 60_000;
const PATIENCE_MS = 10_000;
const ASKED_EVERY_MS = 200;
const COMMAND = 'bun run tagma:restart';

const server = fileURLToPath(new URL('../../../', import.meta.url));

const said = (line: string): void => console.log(`[tagma] ${line}`);

const refuse = (code: string, reason: string, unblock: string[]): never => {
  console.error(refusalLines({ code, reason, unblock }).join('\n'));
  process.exit(2);
};

const loginEnvironment = (): Record<string, string> => {
  const kept: Record<string, string> = {};
  for (const name of KEPT) {
    const value = process.env[name];
    if (value !== undefined) kept[name] = value;
  }
  const shell =
    kept.SHELL ??
    refuse('no-shell', 'SHELL names no login shell, so the PATH of a fresh terminal is unknown', [`SHELL=/bin/zsh ${COMMAND}`]);
  const read = Bun.spawnSync([shell, '-lic', `printf '${PATH_MARK}%s\\n' "$PATH"`], {
    env: kept,
    stdin: 'ignore',
    stderr: 'ignore',
    timeout: LOGIN_MS,
  });
  const line = read.stdout
    .toString()
    .split('\n')
    .find((one) => one.includes(PATH_MARK));
  if (line === undefined) {
    return refuse('no-login-path', `${shell} -lic printed no PATH and exited ${read.exitCode}`, [
      `${shell} -lic 'echo $PATH' — read what the login profile prints`,
    ]);
  }
  return { ...kept, PATH: line.slice(line.indexOf(PATH_MARK) + PATH_MARK.length).trim() };
};

const environment = loginEnvironment();
const data =
  dataDirectory(CHANNEL, environment) ?? refuse('no-home', `HOME names no home directory, so where ${CHANNEL.name} lives is unknown`, []);
const installs =
  installationsRoot(CHANNEL, environment) ??
  refuse('no-home', `HOME names no home directory, so where ${CHANNEL.name} is installed is unknown`, []);
const cli = join(worldDirectory(installs), WORLD_COMMAND);
const window = `/${hostBinary(CHANNEL.name)}`;
const appData = ` ${TAGMA_APP_ENVIRONMENT.data}=${data}/`;

const listed = (args: readonly string[]): readonly string[] =>
  Bun.spawnSync(['ps', ...args])
    .stdout.toString()
    .split('\n');

const running = (): readonly Running[] =>
  listed(['-axww', '-o', 'pid=,ppid=,command=']).flatMap((line) => {
    const row = /^\s*(\d+)\s+(\d+)\s+(.+)$/u.exec(line);
    return row === null ? [] : [{ pid: Number(row[1]), ppid: Number(row[2]), command: row[3]! }];
  });

const tagmaApps = (): ReadonlySet<number> =>
  new Set(listed(['-E', '-axww', '-o', 'pid=,command=']).flatMap((line) => (line.includes(appData) ? [Number.parseInt(line, 10)] : [])));

const subtree = (all: readonly Running[], roots: readonly Running[]): readonly Running[] => {
  const children = Map.groupBy(all, (one) => one.ppid);
  const taken = new Map<number, Running>();
  const take = (one: Running): void => {
    if (taken.has(one.pid)) return;
    taken.set(one.pid, one);
    for (const child of children.get(one.pid) ?? []) take(child);
  };
  for (const root of roots) take(root);
  return [...taken.values()];
};

const windows = (all: readonly Running[]): readonly Running[] =>
  subtree(
    all,
    all.filter((one) => one.command.includes(window)),
  );

const world = (all: readonly Running[]): readonly Running[] => {
  const apps = tagmaApps();
  return subtree(
    all,
    all.filter(
      (one) =>
        one.command.includes(window) || (one.command.startsWith(`${data}/`) && !one.command.includes(' mcp-serve ')) || apps.has(one.pid),
    ),
  );
};

const ancestors = (all: readonly Running[]): ReadonlySet<number> => {
  const parents = new Map(all.map((one) => [one.pid, one.ppid]));
  const chain = new Set<number>();
  for (let pid: number | undefined = process.pid; pid !== undefined && pid > 1 && !chain.has(pid); pid = parents.get(pid)) chain.add(pid);
  return chain;
};

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

const ended = async (pids: readonly number[], signal: NodeJS.Signals): Promise<readonly number[]> => {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }
  const until = Date.now() + PATIENCE_MS;
  let left = pids.filter(alive);
  while (left.length > 0 && Date.now() < until) {
    await Bun.sleep(ASKED_EVERY_MS);
    left = left.filter(alive);
  }
  return left;
};

const step = async (what: string, command: readonly string[], cwd: string): Promise<void> => {
  said(what);
  const code = await Bun.spawn([...command], { cwd, env: environment, stdio: ['inherit', 'inherit', 'inherit'] }).exited;
  if (code === 0) return;
  said(`${command.join(' ')} exited ${code}`);
  process.exit(code);
};

const before = running();
const own = ancestors(before);
const inside = world(before).find((one) => own.has(one.pid));
if (inside !== undefined) {
  refuse('inside-tagma', `this terminal runs inside ${CHANNEL.name} (pid ${inside.pid}), and stopping ${CHANNEL.name} ends it`, [
    `${COMMAND} — run it from a terminal outside ${CHANNEL.name}`,
  ]);
}

const closing = windows(before).map((one) => one.pid);
const unclosed = await ended(closing, 'SIGKILL');
if (unclosed.length > 0) {
  refuse('window-stayed', `${unclosed.join(', ')} of the ${CHANNEL.name} window outlived SIGKILL`, [
    `ps -o pid,stat,command -p ${unclosed.join(',')} — read what holds them`,
  ]);
}
said(closing.length === 0 ? `no ${CHANNEL.name} window was open` : `closed the ${CHANNEL.name} window: ${closing.length} processes`);

if (existsSync(cli)) {
  said(`${CHANNEL.command} quit`);
  const quit = Bun.spawnSync([cli, 'quit'], { env: environment, stdin: 'ignore', stdout: 'inherit', stderr: 'inherit', timeout: QUIT_MS });
  if (quit.exitCode !== 0) {
    said(
      `${CHANNEL.command} quit ${quit.exitCode === null ? `did not finish in ${QUIT_MS} ms` : `exited ${quit.exitCode}`}; what still runs is ended by signal`,
    );
  }
}

const rest = world(running())
  .map((one) => one.pid)
  .filter((pid) => !own.has(pid));
const stubborn = await ended(rest, 'SIGTERM');
const unkilled = await ended(stubborn, 'SIGKILL');
if (unkilled.length > 0) {
  refuse('process-stayed', `${unkilled.join(', ')} outlived SIGKILL`, [
    `ps -o pid,stat,command -p ${unkilled.join(',')} — read what holds them`,
  ]);
}
said(rest.length === 0 ? `nothing else of ${CHANNEL.name} ran` : `ended ${rest.length} processes, ${stubborn.length} of them by SIGKILL`);

await step(`building ${CHANNEL.name} from this checkout`, [process.execPath, 'run', 'build'], server);
await step(`opening ${CHANNEL.name}`, [cli, 'desktop'], installs);
await step('refreshing every place Tagma stands', [cli, 'upgrade'], installs);
