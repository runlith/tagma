import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect, Layer, Option, Stream } from 'effect';
import { NextInstallation } from '../installation/contract/service/next.js';
import { SourceChanges } from './contract/service/changes.js';
import { type CheckoutBuildsOptions, checkoutBuildsLayer } from './runner.js';
import { BuildSteps } from './contract/service/steps.js';
import type { StepVerdict } from './contract/wire/steps.js';
import { spawnedEffect } from '../platform/testing/spawn.js';

const still = Layer.succeed(SourceChanges, { watch: () => Stream.never });
const watched = Layer.succeed(SourceChanges, {
  watch: () => Stream.concat(Stream.make({ history: true, watched: true, paths: null }), Stream.never),
});
const runner = (options: CheckoutBuildsOptions, steps: BuildSteps = BuildSteps.defaultValue(), changes = still) =>
  Effect.map(
    Layer.build(checkoutBuildsLayer(options).pipe(Layer.provide(changes), Layer.provide(Layer.succeed(BuildSteps, steps)))),
    (context) => Context.get(context, NextInstallation),
  );

const stepping = (ask: () => Effect.Effect<StepVerdict>): BuildSteps => ({
  of: () => Effect.succeed([{ app: 'pin', title: 'Core pin', projectId: 7, ask }]),
});

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
  writeFileSync(join(checkout, 'package.json'), JSON.stringify({ name: 'mini', scripts: { 'tagma:build': 'bun build.ts' } }));
  writeFileSync(
    join(checkout, 'build.ts'),
    `import { runSourceBuild } from ${JSON.stringify(join(import.meta.dir, '../installation/testing/sourceBuild.ts'))};\nawait runSourceBuild(import.meta.dir, process.argv.slice(2));\n`,
  );
  const writeScript = (command: string) => writeFileSync(join(checkout, 'build.command'), command);
  writeScript(script);
  yield* git(checkout, 'init', '-q');
  const library = join(dir, 'library');
  mkdirSync(library);
  writeFileSync(join(library, 'value.txt'), 'pinned\n');
  yield* git(library, 'init', '-q');
  yield* git(library, 'add', '.');
  yield* git(library, 'commit', '-q', '-m', 'pinned');
  yield* git(checkout, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', library, 'lib');
  yield* git(checkout, 'add', '.');
  yield* git(checkout, 'commit', '-q', '-m', 'first');
  const log = join(dir, 'data', 'build.log');
  const builds = (more: Partial<CheckoutBuildsOptions> = {}, steps?: BuildSteps, changes?: Layer.Layer<SourceChanges>) =>
    runner(
      {
        checkout,
        log,
        worktrees: join(dir, 'data', 'build'),
        record: join(dir, 'data', 'build.json'),
        landed: () => Promise.resolve('v9'),
        ...more,
      },
      steps,
      changes,
    );
  return { dir, checkout, submodule: join(checkout, 'lib'), builds, log, writeScript };
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

    writeScript('echo working-tree');
    const tree = yield* running.install('tree', null, null);
    expect(yield* settled(running, tree.installing.since)).toMatchObject({ outcome: 'landed', build: 'v9' });
    expect(readFileSync(log, 'utf8')).toContain('working-tree\n');
    const successor = yield* builds();
    expect((yield* successor.reading).installed).toMatchObject({ since: tree.installing.since, outcome: 'landed', build: 'v9' });
    expect((yield* Effect.flip(successor.stop())).code).toBe('nothing-installing');

    const said = (code: string, reason: string, unblock: string) =>
      `printf '%s\\n' '${JSON.stringify({ code, reason, unblock: [unblock] })}' >> "$TAGMA_BUILD_REFUSED"`;
    writeScript(`echo failed-output; ${said('release-failed', 'the bundle did not build', 'read the log')}; exit 3`);
    yield* git(checkout, 'commit', '-qam', 'a build that refuses');
    const failed = yield* successor.install('head', null, null);
    const ended = yield* settled(successor, failed.installing.since);
    expect(ended).toMatchObject({ outcome: 'failed', build: null });
    expect(ended?.detail).toContain('code 2');
    expect(ended?.tail).toContain('failed-output');
    expect([ended?.refused?.code, ended?.refused?.reason, ended?.refused?.unblock[0]]).toEqual([
      'release-failed',
      'the bundle did not build',
      'read the log',
    ]);
    expect(ended?.refused?.unblock.length).toBeGreaterThan(1);

    writeScript(`${said('release-failed', 'the tree did not build', 'fix the tree')}; exit 3`);
    const again = yield* successor.install('tree', null, null);
    expect((yield* settled(successor, again.installing.since))?.refused).toEqual({
      code: 'release-failed',
      reason: 'the tree did not build',
      unblock: ['fix the tree'],
    });
    expect(yield* successor.installing).toBeNull();
  }),
);

it.live(
  'a step is asked again while pending, and the commit it lands before the cut is the one built and named, while the checkout is watched',
  () =>
    Effect.gen(function* () {
      const { checkout, builds, log } = yield* checkoutOf('git log -1 --format=%s');
      let asked = 0;
      const running = yield* builds(
        {},
        stepping(() =>
          Effect.suspend((): Effect.Effect<StepVerdict> => {
            asked += 1;
            return asked < 3
              ? Effect.succeed({ verdict: 'pending' })
              : Effect.as(Effect.orDie(git(checkout, 'commit', '-q', '--allow-empty', '-m', 'landed by the step')), { verdict: 'go' });
          }),
        ),
        watched,
      );
      const started = yield* running.install('head', null, null);
      const ended = yield* settled(running, started.installing.since);
      expect(ended?.outcome).toBe('landed');
      expect(asked).toBe(3);
      expect(readFileSync(log, 'utf8')).toContain('landed by the step\n');
      expect(ended?.target).toBe(yield* git(checkout, 'log', '-1', '--format=%h'));
    }),
);

it.live('a step that stops ends the update unbuilt, carrying its reason and the thread it names', () =>
  Effect.gen(function* () {
    const { builds, log } = yield* checkoutOf('echo built-anyway');
    const running = yield* builds(
      {},
      stepping(() => Effect.succeed({ verdict: 'stop' as const, reason: 'the pin does not converge', thread: 'thread-1' })),
    );
    const started = yield* running.install('head', null, null);
    const ended = yield* settled(running, started.installing.since);
    expect(ended).toMatchObject({
      outcome: 'failed',
      build: null,
      refused: { code: 'build-step-stopped', thread: { projectId: 7, threadId: 'thread-1' } },
    });
    expect(ended?.refused?.reason).toContain('the pin does not converge');
    expect(readFileSync(log, 'utf8')).not.toContain('built-anyway');
  }),
);

it.live('a trial HEAD update builds with the launching home while retaining its isolated installation bindings', () =>
  Effect.gen(function* () {
    const { dir, builds } = yield* checkoutOf(
      'test -f "$HOME/.rustup/settings.toml" && test -f "$HOME/Library/Keychains/login.keychain-db" && echo "$HOME|$TAGMA_PORT|$TAGMA_DATABASE_PATH"',
    );
    const home = join(dir, 'developer');
    for (const file of ['.rustup/settings.toml', 'Library/Keychains/login.keychain-db']) {
      const path = join(home, file);
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, 'developer resource');
    }
    const database = join(dir, 'trial/data/tagma.sqlite');
    const next = yield* builds({
      env: {
        ...process.env,
        HOME: join(dir, 'trial/home'),
        TAGMA_BUILD_HOME: home,
        TAGMA_PORT: '47811',
        TAGMA_DATABASE_PATH: database,
        TAGMA_INSTALLATION_MODE: 'beside',
      },
    });
    const started = yield* next.install('head', null, null);
    const ended = yield* settled(next, started.installing.since);
    expect(ended?.outcome).toBe('landed');
    expect(readFileSync(join(dir, 'data/build.log'), 'utf8')).toContain(`${home}|47811|${database}\n`);
  }),
);

it.live('stopping a HEAD build ends its descendants and worktrees, and a successor recovers a build its server never saw end', () =>
  Effect.gen(function* () {
    const { checkout, submodule, dir, builds } = yield* checkoutOf('sleep 30 & echo $! > ../grandchild; wait');
    const worktrees = (repository: string) =>
      Effect.map(
        git(repository, 'worktree', 'list', '--porcelain'),
        (listed) => listed.split('\n').filter((line) => line.startsWith('worktree ')).length,
      );
    const running = yield* builds({ restart: () => Promise.resolve('restart must not be reached after a stop') });
    const first = yield* running.install('head', 'restart', null);
    const grandchild = join(dir, 'data', 'build', 'grandchild');
    yield* appears(grandchild);
    const sleeper = Number(readFileSync(grandchild, 'utf8').trim());
    expect(alive(sleeper)).toBe(true);
    expect((yield* Effect.flip(running.install('head', null, 'another'))).code).toBe('install-running');
    expect(yield* running.stop()).toMatchObject({ since: first.installing.since, outcome: 'stopped' });
    expect(alive(sleeper)).toBe(false);
    expect(yield* worktrees(checkout)).toBe(1);
    expect(yield* worktrees(submodule)).toBe(1);

    rmSync(grandchild);
    const crashed = yield* running.install('head', null, null);
    yield* appears(grandchild);
    const orphan = Number(readFileSync(grandchild, 'utf8').trim());
    expect(alive(orphan)).toBe(true);
    expect(yield* worktrees(submodule)).toBe(2);
    const successor = yield* builds();
    expect((yield* successor.reading).installed).toMatchObject({ since: crashed.installing.since, outcome: 'failed' });
    expect(yield* successor.installing).toBeNull();
    while (alive(orphan)) yield* Effect.sleep('10 millis');
    expect(alive(orphan)).toBe(false);
    while ((yield* worktrees(submodule)) > 1 || (yield* worktrees(checkout)) > 1) yield* Effect.sleep('10 millis');
  }),
);
