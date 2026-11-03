import { expect } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { digestOf } from '@runlith/executions/hostArtifacts';
import { Context, Deferred, Effect, Exit, Fiber, Layer } from 'effect';
import { makeProcessRestart } from './record.js';
import { openVersion, swapCurrent } from '../../platform/lock/versionedDirectories.js';
import { pruneReleases } from '../closure/leases.js';
import { spawnedEffect } from '../../platform/testing/spawn.js';
import { readInstallation } from '../closure/read.js';
import { writeInstallation } from '../closure/write.js';
import { type Installation, REQUIRED_ROLES } from '../contract/wire/manifest.js';
import { CLI_ENTRY, RUNTIME_PART } from '../contract/wire/layout.js';
import { CURRENT } from '../../platform/contract/wire/versions.js';
import { DataDirectoryConflict } from '../../platform/lock/dataDirectory.js';
import { dataDirectoryHolder } from '../../platform/lock/holder.js';
import { HostUnprepared, Succession } from '../contract/service/succession.js';
import type { SuccessionSteps } from '../contract/service/steps.js';
import { standBy, successionLayer } from './succession.js';

const homed = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), 'tagma-succession-'))),
  (home) => Effect.sync(() => rmSync(home, { recursive: true, force: true })),
);

const succeeding = Effect.fnUntraced(function* (...road: Parameters<typeof successionLayer>) {
  return Context.get(yield* Layer.build(successionLayer(...road)), Succession);
});

const stand = Effect.fnUntraced(function* (root: string, build: string) {
  const version = openVersion(root, build);
  const parts = REQUIRED_ROLES.map((role) => ({
    role,
    path: `parts/${role}`,
    kind: 'file' as const,
    bytes: `${build}:${role}`.length,
    digest: digestOf(new TextEncoder().encode(`${build}:${role}`)),
  }));
  mkdirSync(join(version, 'parts'), { recursive: true });
  for (const role of REQUIRED_ROLES) writeFileSync(join(version, 'parts', role), `${build}:${role}`);
  yield* writeInstallation(version, { os: process.platform, arch: process.arch }, build, parts).pipe(
    Effect.provide(BunFileSystem.layer),
    Effect.orDie,
  );
  swapCurrent(root, build);
  const manifest = yield* readInstallation(version).pipe(Effect.provide(BunFileSystem.layer), Effect.orDie);
  return { root: version, manifest } satisfies Installation;
});

it.live('a cancelled successor leaves a failed record and later disposal cannot add handoff phases', () =>
  Effect.gen(function* () {
    const home = yield* homed;
    const installRoot = join(home, 'install');
    const older = yield* stand(installRoot, 'earlier');
    yield* stand(installRoot, 'later');
    const record = yield* makeProcessRestart({ path: join(home, 'restart.json'), pid: process.pid });
    const entered = Promise.withResolvers<void>();
    const succession = yield* succeeding(
      older,
      installRoot,
      join(home, 'serve.log'),
      () => {},
      {
        releases: true,
        chained: true,
        release: () => {},
        cancel: () => {},
        start: (_command, _env, signal) =>
          new Promise<void>((_resolve, reject) => {
            entered.resolve();
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          }),
      },
      record,
    );
    const running = yield* Effect.forkChild(succession.restart());
    yield* Effect.promise(() => entered.promise);
    yield* Fiber.interrupt(running);
    const failed = yield* record.state;
    expect(failed.record?.failure).not.toBeNull();
    record.close();
    record.point('owners-closed');
    expect(yield* record.state).toEqual(failed);
    expect(yield* succession.leaving).toBe(false);
  }),
);

for (const releases of [true, false]) {
  it.live(`a successor is told to wait for a release only when its launch forwards one (forwards: ${releases})`, () =>
    Effect.gen(function* () {
      const home = yield* homed;
      const installRoot = join(home, 'install');
      const older = yield* stand(installRoot, 'earlier');
      yield* stand(installRoot, 'later');
      const environments: NodeJS.ProcessEnv[] = [];
      const signalled = yield* Deferred.make<void>();
      const succession = yield* succeeding(
        older,
        installRoot,
        join(home, 'serve.log'),
        () => Deferred.doneUnsafe(signalled, Exit.void),
        {
          releases,
          chained: true,
          release: () => {},
          cancel: () => {},
          start: async (_command, env) => {
            environments.push(env);
          },
        },
        yield* makeProcessRestart({ path: join(home, 'restart.json'), pid: process.pid }),
        () => Effect.succeed({ migrations: 3, hostState: join(home, 'host') }),
      );
      const restart = yield* succession.restart();
      expect(restart.migrations).toBe(3);
      expect(environments.map((env) => env['TAGMA_HANDOFF'])).toEqual([releases ? '1' : undefined]);
      expect(environments.map((env) => env['TAGMA_HOST_STATE'])).toEqual([join(home, 'host')]);
      expect(environments.map((env) => typeof env['TAGMA_RESTART_ID'])).toEqual(['string']);
      yield* Deferred.await(signalled);
    }),
  );
}

it.live('a refused restart does not decide the outcome of the next one: a serving successor is not followed by a returned build', () =>
  Effect.gen(function* () {
    const home = yield* homed;
    const installRoot = join(home, 'install');
    const script = join(home, 'successor.ts');
    writeFileSync(
      script,
      `
import { existsSync, writeFileSync } from 'node:fs';
const home = ${JSON.stringify(home)};
if (process.env.TAGMA_REPLACES === undefined) { writeFileSync(home + '/returned', 'yes'); process.exit(0); }
if (!existsSync(home + '/tried')) { writeFileSync(home + '/tried', 'yes'); process.exit(1); }
process.on('message', (said: { _tag: string }) => {
  if (said._tag !== 'Released') return;
  process.send?.({ _tag: 'Taken', pid: process.pid });
  process.send?.({ _tag: 'Serving', pid: process.pid });
  setTimeout(() => process.exit(0), 50);
});
process.send?.('standing-by');
`,
    );
    const succession = yield* succeeding(
      undefined,
      installRoot,
      join(home, 'serve.log'),
      () => {},
      undefined,
      yield* makeProcessRestart({ path: join(home, 'restart.json'), pid: process.pid }),
      undefined,
      undefined,
      [process.execPath, script],
    );
    expect((yield* Effect.flip(succession.restart()))._tag).toBe('SuccessorFailed');
    yield* succession.restart();
    yield* succession.release(null);
    yield* succession.settle;
    yield* Effect.sleep('100 millis');
    expect(existsSync(join(home, 'returned'))).toBe(false);
  }),
);

it.live('a successor that ends before it stands by refuses the restart, and this process is never signalled', () =>
  Effect.gen(function* () {
    const home = yield* homed;
    const installRoot = join(home, 'install');
    const older = yield* stand(installRoot, 'v1');
    const newer = yield* stand(installRoot, 'v2');
    symlinkSync(process.execPath, join(newer.root, RUNTIME_PART));
    mkdirSync(dirname(join(newer.root, CLI_ENTRY)), { recursive: true });
    writeFileSync(join(newer.root, CLI_ENTRY), 'process.exit(3);\n');
    let signalled = 0;
    const succession = yield* succeeding(older, installRoot, join(home, 'serve.log'), () => {
      signalled += 1;
    });

    const refused = yield* Effect.flip(succession.restart());

    expect(refused._tag).toBe('SuccessorFailed');
    expect(refused._tag === 'SuccessorFailed' ? refused.detail : '').toContain(join(installRoot, CURRENT, RUNTIME_PART));
    expect(refused._tag === 'SuccessorFailed' ? refused.detail : '').toContain('code 3');
    expect(signalled).toBe(0);
  }),
);

it.live('a successor lacking a server file its manifest names refuses the restart by that file, and this process is never signalled', () =>
  Effect.gen(function* () {
    const home = yield* homed;
    const installRoot = join(home, 'install');
    const older = yield* stand(installRoot, 'v1');
    const newer = yield* stand(installRoot, 'v2');
    rmSync(join(newer.root, 'parts', 'server'));
    let signalled = 0;
    const succession = yield* succeeding(older, installRoot, join(home, 'serve.log'), () => {
      signalled += 1;
    });

    const refused = yield* Effect.flip(succession.restart());

    expect(refused._tag).toBe('SuccessionRefused');
    expect(refused._tag === 'SuccessionRefused' ? refused.detail : '').toContain('parts/server');
    expect(signalled).toBe(0);
  }),
);

it.live('an installed process over an install root that stands nothing refuses, and nothing is signalled', () =>
  Effect.gen(function* () {
    const home = yield* homed;
    const installRoot = join(home, 'install');
    const own = yield* stand(join(home, 'elsewhere'), 'v1');
    let signalled = 0;
    const succession = yield* succeeding(own, installRoot, join(home, 'serve.log'), () => {
      signalled += 1;
    });

    const refused = yield* Effect.flip(succession.restart());

    expect(refused._tag).toBe('SuccessionRefused');
    expect(refused._tag === 'SuccessionRefused' ? refused.detail : '').toContain(join(installRoot, CURRENT));
    expect(signalled).toBe(0);
  }),
);

it.live('current is what the current link names now, and null with nothing installed', () =>
  Effect.gen(function* () {
    const home = yield* homed;
    const installRoot = join(home, 'install');
    const none = yield* succeeding(undefined, installRoot, join(home, 'serve.log'), () => undefined);
    expect(yield* none.current).toBeNull();

    const stood = yield* stand(installRoot, 'v1');
    const named = yield* none.current;
    expect(named?.manifest.identity.build).toBe(stood.manifest.identity.build);
  }),
);

it.live(
  'a host that cannot prepare the stood-by successor refuses the restart and cancels the successor, and this process is never signalled',
  () =>
    Effect.gen(function* () {
      const home = yield* homed;
      const installRoot = join(home, 'install');
      const older = yield* stand(installRoot, 'earlier');
      yield* stand(installRoot, 'later');
      let signalled = 0;
      let cancelled = 0;
      let withdrawn = 0;
      const steps: SuccessionSteps['Service'] = {
        prepare: () => Effect.fail(new HostUnprepared({ detail: 'the next bundle does not verify' })),
        withdraw: Effect.sync(() => void (withdrawn += 1)),
        weigh: () => Effect.die('this restart weighs nothing'),
      };
      const succession = yield* succeeding(
        older,
        installRoot,
        join(home, 'serve.log'),
        () => {
          signalled += 1;
        },
        { releases: true, chained: true, release: () => {}, cancel: () => (cancelled += 1), start: async () => {} },
        yield* makeProcessRestart({ path: join(home, 'restart.json'), pid: process.pid }),
        undefined,
        Effect.succeed(steps),
      );

      const refused = yield* Effect.flip(succession.restart());

      expect(refused._tag).toBe('HostUnprepared');
      expect(cancelled).toBe(1);
      expect(withdrawn).toBe(1);
      expect(yield* succession.leaving).toBe(false);
      yield* succession.settle;
      expect(signalled).toBe(0);
    }),
);

it.live('a successor refuses a directory that a live process other than the one it replaces holds', () =>
  Effect.gen(function* () {
    const data = join(yield* homed, 'data');
    mkdirSync(data);
    writeFileSync(join(data, 'server.pid'), '1\n');
    const dead = (yield* spawnedEffect(['true'])).pid;

    const refused = yield* Effect.flip(standBy(data, dead));

    expect(refused).toBeInstanceOf(DataDirectoryConflict);
    expect(refused._tag === 'DataDirectoryConflict' ? refused.holder : null).toBe(1);
  }),
);

it.live('a refused installation remains actionable after its server restarts, until another installation is chosen', () =>
  Effect.gen(function* () {
    const home = yield* homed;
    const installRoot = join(home, 'install');
    const older = yield* stand(installRoot, 'earlier');
    const offered = yield* stand(installRoot, 'offered');
    swapCurrent(installRoot, 'earlier');
    const steps: SuccessionSteps['Service'] = {
      prepare: () => Effect.die('a held installation is not launched'),
      withdraw: Effect.void,
      weigh: () => Effect.succeed({ _tag: 'Refuses', detail: 'the host cannot take this bundle' }),
    };
    const refused = yield* Effect.scoped(
      Effect.gen(function* () {
        const first = yield* succeeding(
          older,
          installRoot,
          join(home, 'serve.log'),
          () => undefined,
          undefined,
          undefined,
          undefined,
          Effect.succeed(steps),
        );
        expect((yield* first.weigh(offered.root, join(offered.root, 'desktop', 'carried')))._tag).toBe('Refuses');
        return yield* first.refused;
      }),
    );
    pruneReleases(installRoot, ['earlier'], () => undefined);
    expect(existsSync(offered.root)).toBe(true);
    const restarted = yield* succeeding(older, installRoot, join(home, 'serve.log'), () => undefined);
    expect(yield* restarted.refused).toEqual(refused);
    expect((yield* Effect.flip(restarted.restart()))._tag).toBe('HostUnprepared');
    const notChosen = yield* succeeding(offered, installRoot, join(home, 'serve.log'), () => undefined);
    expect(yield* notChosen.refused).toEqual(refused);
    yield* stand(installRoot, 'another');
    const changed = yield* succeeding(older, installRoot, join(home, 'serve.log'), () => undefined);
    expect(yield* changed.refused).toBeNull();
  }),
);

it.live('a successor whose predecessor died still holding the directory goes on at once', () =>
  Effect.gen(function* () {
    const data = join(yield* homed, 'data');
    mkdirSync(data);
    const dead = (yield* spawnedEffect(['true'])).pid;
    writeFileSync(join(data, 'server.pid'), `${dead}\n`);

    const stood = yield* standBy(data, dead);
    expect(dataDirectoryHolder(data)).toBe(process.pid);
    yield* stood.lock.release;
  }),
);
