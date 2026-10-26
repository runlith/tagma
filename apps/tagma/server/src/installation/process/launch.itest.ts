import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pidAlive } from '@runlith/utils/process';
import { Schema } from 'effect';
import { dataDirectoryHolder } from '../../platform/lock/holder.js';
import { ServerLaunch } from './launch.js';
import { SUPERVISED } from '../contract/wire/launch.js';

const server = fileURLToPath(new URL('../testing/launchServer.ts', import.meta.url));
const ownerEntry = fileURLToPath(new URL('../testing/launchOwner.ts', import.meta.url));

type Standing = { readonly pid: number; readonly port: number };

const nextStanding = async (home: string, previous: number | null): Promise<Standing> => {
  const path = join(home, 'standing.json');
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    if (existsSync(path)) {
      const standing: Standing = JSON.parse(readFileSync(path, 'utf8'));
      if (standing.pid !== previous) return standing;
    }
    await Bun.sleep(20);
  }
  throw new Error('the next server did not stand');
};

const ask = (standing: Standing, path: string) => fetch(`http://127.0.0.1:${standing.port}/${path}`);

const gone = async (pid: number): Promise<void> => {
  const until = Date.now() + 5000;
  while (pidAlive(pid)) {
    if (Date.now() >= until) throw new Error(`pid ${pid} stayed after cancellation`);
    await Bun.sleep(20);
  }
};

test('the launch owns successive servers, refuses a failed candidate, and closes every generation on hangup', async () => {
  const home = mkdtempSync(join(tmpdir(), 'tagma-launch-'));
  const launch = new ServerLaunch([process.execPath, server], { ...process.env, LAUNCH_TEST_HOME: home }, join(home, 'serve.log'));
  const pids: number[] = [];
  try {
    const bootstrap = mkdtempSync(join(tmpdir(), 'tagma-launch-bootstrap-'));
    const connecting = join(bootstrap, 'connecting');
    const late = Bun.spawn([process.execPath, server, '--after-disconnect'], {
      env: { ...process.env, LAUNCH_TEST_HOME: bootstrap, [SUPERVISED]: '1' },
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
      ipc: () => {},
    });
    try {
      const until = Date.now() + 5000;
      while (!existsSync(connecting)) {
        if (Date.now() >= until) throw new Error('the late connection did not reach bootstrap');
        await Bun.sleep(20);
      }
      late.disconnect();
      const exited = await new Promise<number>((resolve, reject) => {
        const deadline = setTimeout(() => reject(new Error('a server booted after its launch had disconnected')), 1000);
        void late.exited.then(
          (code) => {
            clearTimeout(deadline);
            resolve(code);
          },
          (cause: unknown) => {
            clearTimeout(deadline);
            reject(cause);
          },
        );
      });
      expect(exited).toBe(1);
      expect(dataDirectoryHolder(bootstrap)).toBeNull();
    } finally {
      if (late.exitCode === null && late.signalCode === null) late.kill('SIGTERM');
      await late.exited;
      rmSync(bootstrap, { recursive: true, force: true });
    }
    let standing = await nextStanding(home, null);
    pids.push(standing.pid);
    const failed = Schema.decodeUnknownSync(Schema.Struct({ failure: Schema.String, pid: Schema.Int }))(
      await (await ask(standing, 'fail')).json(),
    );
    expect(failed.pid).toBe(standing.pid);
    const cancelled = Schema.decodeUnknownSync(Schema.Struct({ failure: Schema.String, pid: Schema.Int }))(
      await (await ask(standing, 'cancel')).json(),
    );
    await gone(cancelled.pid);
    const answering = Schema.decodeUnknownSync(Schema.Struct({ pid: Schema.Int }))(await (await ask(standing, '')).json());
    expect(answering.pid).toBe(standing.pid);
    expect(dataDirectoryHolder(home)).toBe(standing.pid);
    for (let replacement = 0; replacement < 2; replacement += 1) {
      const response = await ask(standing, 'restart');
      expect(response.ok).toBe(true);
      const predecessor = standing.pid;
      standing = await nextStanding(home, predecessor);
      expect(dataDirectoryHolder(home)).toBe(standing.pid);
      expect(pidAlive(standing.pid)).toBe(true);
      expect(existsSync(join(home, `closed-${predecessor}`))).toBe(true);
      pids.push(standing.pid);
    }
    expect(new Set(pids).size).toBe(3);
    expect(await launch.stop('SIGHUP')).toBe(0);
    expect(dataDirectoryHolder(home)).toBeNull();
    for (const pid of pids) {
      expect(pidAlive(pid)).toBe(false);
      expect(existsSync(join(home, `closed-${pid}`))).toBe(true);
    }
  } finally {
    await launch.stop();
    rmSync(home, { recursive: true, force: true });
  }
}, 10000);

test('the launch closes in-flight candidates and its servers leave when the owner dies', async () => {
  const home = mkdtempSync(join(tmpdir(), 'tagma-launch-'));
  const launch = new ServerLaunch([process.execPath, server], { ...process.env, LAUNCH_TEST_HOME: home }, join(home, 'serve.log'));
  try {
    const standing = await nextStanding(home, null);
    const pending = ask(standing, 'pending').then(
      (response) => response.text(),
      (cause: unknown) => cause,
    );
    const marker = join(home, 'candidate');
    const until = Date.now() + 5000;
    while (!existsSync(marker)) {
      if (Date.now() >= until) throw new Error('the candidate did not start');
      await Bun.sleep(20);
    }
    const candidate = Number(readFileSync(marker, 'utf8'));
    expect(pidAlive(candidate)).toBe(true);
    await launch.stop('SIGHUP');
    await pending;
    expect(pidAlive(candidate)).toBe(false);
    expect(pidAlive(standing.pid)).toBe(false);
    expect(dataDirectoryHolder(home)).toBeNull();
    expect(existsSync(join(home, `closed-${standing.pid}`))).toBe(true);
    const owner = Bun.spawn([process.execPath, ownerEntry], {
      env: { ...process.env, LAUNCH_TEST_HOME: home },
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
    });
    let owned: Standing | undefined;
    try {
      owned = await nextStanding(home, standing.pid);
      owner.kill('SIGKILL');
      await owner.exited;
      await gone(owned.pid);
      expect(existsSync(join(home, `closed-${owned.pid}`))).toBe(true);
      expect(dataDirectoryHolder(home)).toBeNull();
    } finally {
      if (owner.exitCode === null && owner.signalCode === null) owner.kill('SIGTERM');
      await owner.exited;
      if (owned !== undefined && pidAlive(owned.pid)) {
        process.kill(owned.pid, 'SIGTERM');
        await gone(owned.pid);
      }
    }
  } finally {
    await launch.stop();
    rmSync(home, { recursive: true, force: true });
  }
}, 10000);

test('a successor that ends after taking the data directory leaves the launch running the build it replaced', async () => {
  const home = mkdtempSync(join(tmpdir(), 'tagma-launch-'));
  const launch = new ServerLaunch(
    [process.execPath, server],
    { ...process.env, LAUNCH_TEST_HOME: home, LAUNCH_TEST_FAIL_AFTER_TAKE: '1' },
    join(home, 'serve.log'),
  );
  try {
    const first = await nextStanding(home, null);
    expect((await ask(first, 'restart')).ok).toBe(true);
    const returned = await nextStanding(home, first.pid);
    expect(pidAlive(returned.pid)).toBe(true);
    expect(dataDirectoryHolder(home)).toBe(returned.pid);
    expect(existsSync(join(home, `closed-${first.pid}`))).toBe(true);
    expect(readFileSync(join(home, 'serve.log'), 'utf8')).toContain('returned by pid');
  } finally {
    await launch.stop();
    rmSync(home, { recursive: true, force: true });
  }
}, 15000);

test.each([
  {
    outcome: 'a predecessor whose owners failed to close still releases the directory, and the successor serves naming why',
    extra: { LAUNCH_TEST_RELEASE_FAILURE: 'owners failed to close' } as Record<string, string>,
  },
  {
    outcome: 'a predecessor that ends without releasing leaves the successor serving, naming that it left',
    extra: { LAUNCH_TEST_LEAVE_UNRELEASED: '1' } as Record<string, string>,
  },
])(
  'without a launch, $outcome',
  async ({ extra }) => {
    const home = mkdtempSync(join(tmpdir(), 'tagma-launch-'));
    const first = Bun.spawn([process.execPath, server], {
      env: { ...process.env, LAUNCH_TEST_HOME: home, LAUNCH_TEST_UNSUPERVISED: '1', ...extra },
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
    });
    let standing: Standing | undefined;
    try {
      standing = await nextStanding(home, null);
      const predecessor = standing.pid;
      expect((await ask(standing, 'restart')).ok).toBe(true);
      standing = await nextStanding(home, predecessor);
      expect(dataDirectoryHolder(home)).toBe(standing.pid);
      await gone(predecessor);
      const named = join(home, `unreleased-${standing.pid}`);
      expect(existsSync(named)).toBe(true);
      const reason = readFileSync(named, 'utf8');
      expect(reason).toBe(extra.LAUNCH_TEST_RELEASE_FAILURE ?? `pid ${predecessor} left without releasing the data directory`);
    } finally {
      if (standing !== undefined && pidAlive(standing.pid)) {
        process.kill(standing.pid, 'SIGTERM');
        await gone(standing.pid);
      }
      if (first.exitCode === null && first.signalCode === null) first.kill('SIGTERM');
      await first.exited;
      rmSync(home, { recursive: true, force: true });
    }
  },
  15000,
);

test.each([
  { fails: false, outcome: 'the successor serves and the predecessor leaves' },
  { fails: true, outcome: 'a successor that ends after taking the data directory leaves the predecessor starting itself again' },
])(
  'without a launch, $outcome',
  async ({ fails }) => {
    const home = mkdtempSync(join(tmpdir(), 'tagma-launch-'));
    const first = Bun.spawn([process.execPath, server], {
      env: {
        ...process.env,
        LAUNCH_TEST_HOME: home,
        LAUNCH_TEST_UNSUPERVISED: '1',
        ...(fails ? { LAUNCH_TEST_FAIL_AFTER_TAKE: '1' } : {}),
      },
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
    });
    let standing: Standing | undefined;
    try {
      standing = await nextStanding(home, null);
      const predecessor = standing.pid;
      expect((await ask(standing, 'restart')).ok).toBe(true);
      standing = await nextStanding(home, predecessor);
      expect(dataDirectoryHolder(home)).toBe(standing.pid);
      await gone(predecessor);
      expect(existsSync(join(home, `closed-${predecessor}`))).toBe(true);
      expect(fails).toBe(readFileSync(join(home, 'serve.log'), 'utf8').includes('returned by pid'));
    } finally {
      if (standing !== undefined && pidAlive(standing.pid)) {
        process.kill(standing.pid, 'SIGTERM');
        await gone(standing.pid);
      }
      if (first.exitCode === null && first.signalCode === null) first.kill('SIGTERM');
      await first.exited;
      rmSync(home, { recursive: true, force: true });
    }
  },
  15000,
);
