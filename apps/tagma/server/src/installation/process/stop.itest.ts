import { expect } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from '@runlith/effect-test';
import { Effect, Fiber, Layer } from 'effect';
import { pidAlive } from '@runlith/utils/process';
import { testLockHolders, testProcesses } from '../testing/processes.js';
import { activeHolder, takeActive } from '../setup/active.js';
import { switchFrom } from '../setup/switch.js';
import { junctionDirectory } from '../contract/wire/junction.js';
import { stopChain } from './chain.js';
import { dataDirectoryLocked } from '../../platform/lock/holder.js';

const native = Layer.merge(testProcesses, testLockHolders);
const server = new URL('../testing/launchServer.ts', import.meta.url).pathname;
const active = new URL('../setup/active.ts', import.meta.url).href;
const rooted = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), 'tagma-stop-'))),
  (root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
);
const waitFor = Effect.fnUntraced(function* (path: string) {
  while (!existsSync(path)) yield* Effect.sleep('10 millis');
});
const cliAt = (home: string) => {
  const cli = join(home, 'cli');
  writeFileSync(cli, '#!/bin/sh\necho \'{"_tag":"ShutdownComplete"}\'\n');
  chmodSync(cli, 0o755);
  return cli;
};

it.live('switching during a prepared restart cancels both generations and leaves the active lock to the chosen channel', () =>
  Effect.gen(function* () {
    const home = yield* rooted;
    const cli = cliAt(home);
    const env = {
      ...process.env,
      HOME: home,
      LAUNCH_TEST_HOME: home,
      LAUNCH_TEST_CLI: cli,
      LAUNCH_TEST_UNSUPERVISED: '1',
      LAUNCH_TEST_HOLD_CLOSE: '1',
    };
    const first = yield* Effect.acquireRelease(
      Effect.sync(() => Bun.spawn([process.execPath, server], { env, stdin: 'ignore', stdout: 'ignore', stderr: 'inherit' })),
      (child) =>
        Effect.gen(function* () {
          writeFileSync(join(home, 'close'), 'close');
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
          yield* Effect.promise(() => child.exited);
          if (existsSync(join(home, 'process.json'))) {
            const record = JSON.parse(readFileSync(join(home, 'process.json'), 'utf8')) as { id: string };
            yield* stopChain({ id: record.id, path: join(home, 'process.json') }).pipe(Effect.orDie);
          }
        }),
    );
    yield* waitFor(join(home, 'standing.json'));
    const standing = JSON.parse(readFileSync(join(home, 'standing.json'), 'utf8')) as { port: number };
    const restarted = yield* Effect.promise(() => fetch(`http://127.0.0.1:${standing.port}/restart`));
    expect(restarted.ok).toBe(true);
    yield* waitFor(join(home, 'closing'));
    const junction = junctionDirectory(env)!;
    const holder = activeHolder(junction);
    if (holder === null) return yield* Effect.die('the predecessor did not hold its active lock');
    const stopping = yield* Effect.forkChild(switchFrom(holder, env));
    while (!(JSON.parse(readFileSync(join(home, 'process.json'), 'utf8')) as { stopping: boolean }).stopping)
      yield* Effect.sleep('10 millis');
    writeFileSync(join(home, 'close'), 'close');
    expect((yield* Fiber.join(stopping)).killed).toBe(false);
    expect(yield* Effect.promise(() => first.exited)).toBe(0);
    const members = (JSON.parse(readFileSync(join(home, 'process.json'), 'utf8')) as { members: { pid: number }[] }).members;
    expect(members.every((member) => !pidAlive(member.pid))).toBe(true);
    expect(dataDirectoryLocked(home)).toBeNull();
    const chosen = takeActive(junction, { channel: 'stable', cli, url: 'http://127.0.0.1:1', pid: process.pid });
    expect(chosen._tag).toBe('Taken');
    if (chosen._tag === 'Taken') chosen.release();
  }).pipe(Effect.scoped, Effect.provide(native)),
);

it.live('an issued predecessor that can return after its candidate dies never yields a proven stop', () =>
  Effect.gen(function* () {
    const home = yield* rooted;
    const cli = cliAt(home);
    const script = join(home, 'issued.ts');
    const junction = junctionDirectory({ HOME: home })!;
    writeFileSync(
      script,
      `
import { existsSync, writeFileSync } from 'node:fs';
import { takeActive } from ${JSON.stringify(active)};
const home = ${JSON.stringify(home)};
const own = { channel: 'dev', cli: ${JSON.stringify(cli)}, url: 'http://127.0.0.1:0', pid: process.pid };
if (process.argv.includes('returned')) {
  while (!existsSync(home + '/arrive')) await Bun.sleep(10);
  const taken = takeActive(${JSON.stringify(junction)}, own);
  if (taken._tag !== 'Taken') process.exit(2);
  writeFileSync(home + '/returned', String(process.pid));
  process.on('SIGTERM', () => { taken.release(); process.exit(0); });
  setInterval(() => {}, 1000);
} else {
  const taken = takeActive(${JSON.stringify(junction)}, own);
  if (taken._tag !== 'Taken') process.exit(2);
  const candidate = Bun.spawn([process.execPath, '-e', 'setInterval(() => {}, 1000)'], { detached: true, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
  writeFileSync(home + '/prepared', String(candidate.pid));
  process.on('SIGTERM', async () => {
    taken.release();
    candidate.kill('SIGKILL');
    await candidate.exited;
    const returned = Bun.spawn([process.execPath, ${JSON.stringify(script)}, 'returned'], { detached: true, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
    writeFileSync(home + '/returning', String(returned.pid));
    returned.unref();
    process.exit(0);
  });
  setInterval(() => {}, 1000);
}
`,
    );
    const first = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.spawn([process.execPath, script], {
          env: { ...process.env, HOME: home },
          stdin: 'ignore',
          stdout: 'ignore',
          stderr: 'inherit',
        }),
      ),
      (child) =>
        Effect.gen(function* () {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
          yield* Effect.promise(() => child.exited);
          for (const marker of ['prepared', 'returning'])
            if (existsSync(join(home, marker))) {
              const pid = Number(readFileSync(join(home, marker), 'utf8'));
              if (pidAlive(pid)) process.kill(pid, 'SIGKILL');
              while (pidAlive(pid)) yield* Effect.sleep('10 millis');
            }
        }),
    );
    yield* waitFor(join(home, 'prepared'));
    const holder = activeHolder(junction);
    if (holder === null) return yield* Effect.die('the issued predecessor did not hold its lock');
    const refused = yield* Effect.flip(switchFrom(holder, { HOME: home }));
    expect(refused.code).toBe('chain-unproven');
    expect(yield* Effect.promise(() => first.exited)).toBe(0);
    yield* waitFor(join(home, 'returning'));
    writeFileSync(join(home, 'arrive'), 'arrive');
    yield* waitFor(join(home, 'returned'));
    expect(activeHolder(junction)).toMatchObject({ pid: Number(readFileSync(join(home, 'returned'), 'utf8')) });
  }).pipe(Effect.scoped, Effect.provide(native)),
);
