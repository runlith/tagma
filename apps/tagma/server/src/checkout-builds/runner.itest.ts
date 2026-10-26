import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect, Layer, Option, Stream } from 'effect';
import { NextInstallation } from '../installation/contract/service/next.js';
import { SourceChanges } from './contract/service/changes.js';
import { type CheckoutBuildsOptions, checkoutBuildsLayer } from './runner.js';
import { spawnedEffect } from '../platform/testing/spawn.js';

const still = Layer.succeed(SourceChanges, { watch: () => Stream.never });
const runner = (options: CheckoutBuildsOptions) =>
  Effect.map(Layer.build(checkoutBuildsLayer(options).pipe(Layer.provide(still))), (context) => Context.get(context, NextInstallation));

const git = Effect.fnUntraced(function* (cwd: string, ...args: string[]) {
  const ran = yield* spawnedEffect(['git', '-C', cwd, ...args], {
    env: { ...process.env, GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: 'a@b', GIT_COMMITTER_NAME: 'a', GIT_COMMITTER_EMAIL: 'a@b' },
  });
  if (ran.exitCode !== 0) return yield* Effect.die(`git ${args.join(' ')}: ${ran.stderr.toString()}`);
  return ran.stdout.toString().trim();
});

const checkoutOf = Effect.fnUntraced(function* (script: string) {
  const dir = yield* Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), 'tagma-build-'))),
    (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
  );
  const checkout = join(dir, 'checkout');
  mkdirSync(checkout);
  const writeScript = (command: string) =>
    writeFileSync(join(checkout, 'package.json'), JSON.stringify({ name: 'mini', scripts: { 'tagma:build': `sh -c '${command}'` } }));
  writeScript(script);
  yield* git(checkout, 'init', '-q');
  yield* git(checkout, 'add', '.');
  yield* git(checkout, 'commit', '-q', '-m', 'first');
  const log = join(dir, 'data', 'build.log');
  const builds = (more: Partial<CheckoutBuildsOptions> = {}) =>
    runner({
      checkout,
      log,
      worktrees: join(dir, 'data', 'build'),
      record: join(dir, 'data', 'build.json'),
      landed: () => Promise.resolve('v9'),
      ...more,
    });
  return { dir, checkout, builds, log, writeScript };
});

const settled = Effect.fnUntraced(function* (next: NextInstallation['Service'], since: string) {
  const frame = yield* next.changes.pipe(
    Stream.filter((frame) => frame.installed?.since === since),
    Stream.runHead,
  );
  return Option.getOrThrow(frame).installed;
});

const appears = Effect.fnUntraced(function* (path: string) {
  while (!existsSync(path)) yield* Effect.sleep('10 millis');
});

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

it.live('HEAD builds use a disposable worktree, tree builds use the checkout, and the durable result survives the next reader', () =>
  Effect.gen(function* () {
    const { checkout, dir, builds, log, writeScript } = yield* checkoutOf('pwd');
    writeFileSync(join(checkout, 'extra.txt'), 'uncommitted');
    const running = yield* builds();
    expect((yield* Effect.flip(running.install('nightly', null, null))).code).toBe('no-offer');
    const head = yield* running.install('head', null, null);
    expect(head.installing.target).not.toContain('-dirty');
    expect(yield* settled(running, head.installing.since)).toMatchObject({ outcome: 'landed', build: 'v9' });
    expect(readFileSync(log, 'utf8')).toContain(join(dir, 'data', 'build', 'head-'));
    expect((yield* git(checkout, 'worktree', 'list')).split('\n')).toHaveLength(1);

    const tree = yield* running.install('tree', null, null);
    expect(yield* settled(running, tree.installing.since)).toMatchObject({ outcome: 'landed', build: 'v9' });
    expect(readFileSync(log, 'utf8')).toContain(`${checkout}\n`);
    const successor = yield* builds();
    expect((yield* successor.reading).installed).toMatchObject({ since: tree.installing.since, outcome: 'landed', build: 'v9' });
    expect((yield* Effect.flip(successor.stop())).code).toBe('nothing-installing');

    writeScript('echo failed-output; exit 3');
    const failed = yield* successor.install('tree', null, null);
    const ended = yield* settled(successor, failed.installing.since);
    expect(ended).toMatchObject({ outcome: 'failed', build: null });
    expect(ended?.detail).toContain('code 3');
    expect(ended?.tail).toContain('failed-output');
    expect(yield* successor.installing).toBeNull();
  }),
);

it.live('stopping a HEAD build ends its descendants and worktree, and a successor recovers a build its server never saw end', () =>
  Effect.gen(function* () {
    const { checkout, dir, builds } = yield* checkoutOf('sleep 30 & echo $! > ../grandchild; wait');
    const running = yield* builds({ restart: () => Promise.resolve('restart must not be reached after a stop') });
    const first = yield* running.install('head', 'restart', null);
    const grandchild = join(dir, 'data', 'build', 'grandchild');
    yield* appears(grandchild);
    const sleeper = Number(readFileSync(grandchild, 'utf8').trim());
    expect(alive(sleeper)).toBe(true);
    expect((yield* Effect.flip(running.install('head', null, 'another'))).code).toBe('install-running');
    expect(yield* running.stop()).toMatchObject({ since: first.installing.since, outcome: 'stopped' });
    expect(alive(sleeper)).toBe(false);
    expect((yield* git(checkout, 'worktree', 'list')).split('\n')).toHaveLength(1);

    rmSync(grandchild);
    const crashed = yield* running.install('head', null, null);
    yield* appears(grandchild);
    const orphan = Number(readFileSync(grandchild, 'utf8').trim());
    expect(alive(orphan)).toBe(true);
    const successor = yield* builds();
    expect((yield* successor.reading).installed).toMatchObject({ since: crashed.installing.since, outcome: 'failed' });
    expect(yield* successor.installing).toBeNull();
    while (alive(orphan)) yield* Effect.sleep('10 millis');
    expect(alive(orphan)).toBe(false);
  }),
);
