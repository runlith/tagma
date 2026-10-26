import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { type FSWatcher, watch } from 'node:fs';
import { pidAlive } from '@runlith/utils/process';

export type DevStep = {
  name: string;
  command: string;
  args: readonly string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
};

export type DevProcess = DevStep & {
  readyUrl?: URL;
  whenRunning?: 'adopt' | 'replace';
  restartOn?: RestartWatch;
};

export type RestartWatch = {
  dir: string;
  suffix?: string;
};

export type DevRunOptions = {
  label: string;
  steps?: readonly DevStep[];
  processes: readonly DevProcess[];
};

const READY_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 250;
const READY_PROBE_TIMEOUT_MS = 500;
const STOP_TERM_TIMEOUT_MS = 12_000;
const STOP_KILL_TIMEOUT_MS = 2000;
const RESTART_DEBOUNCE_MS = 120;

export async function runDev(options: DevRunOptions): Promise<never> {
  const stack = new DevSupervisor(options.label);
  try {
    for (const step of options.steps ?? []) await stack.runStep(step);

    let supervised = false;
    for (const proc of options.processes) supervised = (await stack.start(proc)) !== null || supervised;
    if (!supervised) return await stack.shutdown(0);

    return await stack.stand();
  } catch (error) {
    console.error(`[${options.label}] startup failed`, error);
    return await stack.shutdown(1);
  }
}

class DevSupervisor {
  private readonly children = new Map<ChildProcess, string>();
  private readonly standing = new Map<string, ChildProcess>();
  private readonly restarting = new Set<ChildProcess>();
  private readonly watchers = new Set<FSWatcher>();
  private stopping: Promise<never> | null = null;

  constructor(readonly label: string) {
    process.once('SIGINT', () => void this.shutdown(130));
    process.once('SIGTERM', () => void this.shutdown(143));
  }

  stand(): Promise<never> {
    return new Promise<never>(() => {});
  }

  async runStep(step: DevStep): Promise<void> {
    const child = spawn(step.command, [...step.args], {
      cwd: step.cwd,
      env: step.env ?? process.env,
      stdio: 'inherit',
    });
    const code = await waitForExit(child);
    if (code !== 0) throw new Error(`${step.name} failed with exit code ${code}.`);
  }

  async start(proc: DevProcess): Promise<ChildProcess | null> {
    const readyUrl = proc.readyUrl;
    if (readyUrl && proc.whenRunning && (await reachable(readyUrl))) {
      if (proc.whenRunning === 'adopt') {
        console.log(`[${this.label}] ${proc.name} is already running at ${readyUrl.origin}`);
        return null;
      }
      await this.replaceRunning(proc, readyUrl);
    }
    const child = this.spawnManaged(proc);
    if (proc.readyUrl) await this.waitForReady(proc, child, proc.readyUrl);
    if (proc.restartOn) this.watchArtifact(proc, proc.restartOn);
    return child;
  }

  private async replaceRunning(proc: DevProcess, readyUrl: URL): Promise<void> {
    const pids = await listenerPids(readyUrl);
    console.log(`[${this.label}] replacing ${proc.name} at ${readyUrl.origin} (pid ${pids.join(', ') || 'unknown'})`);
    for (const pid of pids) signalPid(pid, 'SIGTERM');
    if (await stopped(pids, readyUrl, STOP_TERM_TIMEOUT_MS)) return;
    for (const pid of pids) signalPid(pid, 'SIGKILL');
    if (!(await stopped(pids, readyUrl, STOP_KILL_TIMEOUT_MS))) {
      throw new Error(`${proc.name} still runs at ${readyUrl.origin}; stop it and run again.`);
    }
  }

  async shutdown(code: number): Promise<never> {
    this.stopping ??= (async () => {
      for (const watcher of this.watchers) watcher.close();
      await Promise.all(Array.from(this.children, ([child, name]) => this.stopChild(name, child)));
      process.exit(code);
    })();
    return this.stopping;
  }

  private watchArtifact(proc: DevProcess, artifact: RestartWatch): void {
    let debounce: ReturnType<typeof setTimeout> | undefined;
    this.watchers.add(
      watch(artifact.dir, (_event, filename) => {
        if (artifact.suffix !== undefined && !filename?.endsWith(artifact.suffix)) return;
        clearTimeout(debounce);
        debounce = setTimeout(() => void this.restart(proc), RESTART_DEBOUNCE_MS);
      }),
    );
  }

  private async restart(proc: DevProcess): Promise<void> {
    if (this.stopping) return;
    const running = this.standing.get(proc.name);
    if (running) {
      this.restarting.add(running);
      await this.stopChild(proc.name, running);
    }
    if (this.stopping) return;
    console.log(`[${this.label}] restarting ${proc.name}`);
    this.spawnManaged(proc);
  }

  private spawnManaged(proc: DevStep): ChildProcess {
    const child = spawn(proc.command, [...proc.args], {
      cwd: proc.cwd,
      env: proc.env ?? process.env,
      stdio: 'inherit',
    });
    this.children.set(child, proc.name);
    this.standing.set(proc.name, child);
    child.once('exit', (exitCode, signal) => {
      this.children.delete(child);
      if (this.restarting.delete(child)) return;
      if (this.stopping) return;
      void this.shutdown(exitCode ?? (signal ? 1 : 0));
    });
    child.once('error', (error) => {
      console.error(`[${this.label}] ${proc.name} failed to start`, error);
      void this.shutdown(1);
    });
    return child;
  }

  private async waitForReady(proc: DevProcess, child: ChildProcess, url: URL): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) break;
      if (await reachable(url)) return;
      await sleep(READY_POLL_MS);
    }
    throw new Error(`${proc.name} did not become reachable at ${url.origin}.`);
  }

  private async stopChild(name: string, child: ChildProcess): Promise<void> {
    this.children.delete(child);
    await signalChild(child, 'SIGTERM');
    if (await waitForStop(child, STOP_TERM_TIMEOUT_MS)) return;
    await signalChild(child, 'SIGKILL');
    if (!(await waitForStop(child, STOP_KILL_TIMEOUT_MS))) {
      console.warn(`[${this.label}] ${name} did not exit after SIGKILL`);
    }
  }
}

async function reachable(url: URL): Promise<boolean> {
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(READY_PROBE_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function output(command: string, args: readonly string[]): Promise<string | null> {
  return new Promise((resolveOutput) => {
    execFile(command, [...args], { encoding: 'utf8' }, (error, stdout) => resolveOutput(error ? null : stdout));
  });
}

async function listenerPids(url: URL): Promise<number[]> {
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  const listed = await output('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']);
  if (listed === null) return [];
  return listed
    .split('\n')
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

async function stopped(pids: readonly number[], url: URL, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const gone = () => pids.every((pid) => !pidAlive(pid));
  while (Date.now() < deadline) {
    if (gone() && !(await reachable(url))) return true;
    await sleep(READY_POLL_MS);
  }
  return gone() && !(await reachable(url));
}

async function waitForExit(child: ChildProcess): Promise<number> {
  return await new Promise((resolveExit) => {
    child.once('exit', (code, signal) => resolveExit(code ?? (signal ? 1 : 0)));
  });
}

async function signalChild(child: ChildProcess, signal: NodeJS.Signals): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) return;
  if (process.platform !== 'win32') {
    await signalProcessTree(pid, signal);
    return;
  }
  try {
    child.kill(signal);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return;
    throw error;
  }
}

async function waitForExitOrTimeout(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return await new Promise((resolveExit) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolveExit(false);
    }, timeoutMs);
    child.once('exit', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveExit(true);
    });
  });
}

async function waitForStop(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (process.platform === 'win32') return waitForExitOrTimeout(child, timeoutMs);
  const pid = child.pid;
  if (pid === undefined) return true;
  if (!(await processTreeAlive(pid))) return true;
  const deadline = Date.now() + timeoutMs;
  while (true) {
    await sleep(50);
    if (!(await processTreeAlive(pid))) return true;
    if (Date.now() >= deadline) return false;
  }
}

async function signalProcessTree(pid: number, signal: NodeJS.Signals): Promise<void> {
  const pids = [...(await descendantPids(pid))].reverse();
  for (const childPid of pids) signalPid(childPid, signal);
  signalPid(pid, signal);
}

async function processTreeAlive(pid: number): Promise<boolean> {
  return processAlive(pid) || (await descendantPids(pid)).some(processAlive);
}

async function descendantPids(rootPid: number): Promise<number[]> {
  const listed = await output('ps', ['-axo', 'pid=,ppid=']);
  if (listed === null) return [];
  const children = new Map<number, number[]>();
  for (const line of listed.split('\n')) {
    const [rawPid, rawParentPid] = line.trim().split(/\s+/);
    const pid = Number(rawPid);
    const parentPid = Number(rawParentPid);
    if (!Number.isInteger(pid) || !Number.isInteger(parentPid)) continue;
    const bucket = children.get(parentPid);
    if (bucket) bucket.push(pid);
    else children.set(parentPid, [pid]);
  }
  const resultPids: number[] = [];
  const stack = [...(children.get(rootPid) ?? [])];
  while (stack.length > 0) {
    const pid = stack.pop();
    if (pid === undefined) continue;
    resultPids.push(pid);
    stack.push(...(children.get(pid) ?? []));
  }
  return resultPids;
}

function signalPid(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return;
    throw error;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
    throw error;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
