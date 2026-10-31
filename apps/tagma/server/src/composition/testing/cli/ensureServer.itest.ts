import { expect } from 'bun:test';
import { kind, own } from '@runlith/testbed/worlds';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { FixtureScope } from '../../../platform/testing/scope.js';
import { digestOf } from '@runlith/executions/hostArtifacts';
import { Context, Data, Effect, Fiber, FileSystem, Layer, Queue, Schedule } from 'effect';
import { openVersion, swapCurrent } from '../../../installation/testing/doubles.js';
import { writeInstallation } from '../../../installation/testing/doubles.js';
import { type InstallationPart, type InstallationRole, REQUIRED_ROLES } from '../../../installation/contract/wire/manifest.js';
import { hostBundle, CURRENT } from '../../../installation/contract/wire/layout.js';
import { CHANNEL } from '@tagma/server/composition/channel';
import { CHANNELS } from '../../../installation/contract/wire/channel.js';
import { junctionDirectory } from '../../../installation/contract/wire/junction.js';
import { takeActive } from '../../../installation/setup/active.js';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import { dataDirectoryLocked } from '../../../platform/lock/holder.js';
import { capturedEffect } from '../captured.js';

const ENTRY = join(import.meta.dir, '../../developer/cli.ts');

class StillStanding extends Data.TaggedError('StillStanding')<{ readonly pid: number }> {}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const freePort = Effect.promise(async () => {
  const listening = Bun.serve({ port: 0, fetch: () => new Response('') });
  const taken = listening.port;
  await listening.stop(true);
  return taken as number;
});

const untilGone = (pid: number) =>
  Effect.retry(
    Effect.suspend(() => (alive(pid) ? Effect.fail(new StillStanding({ pid })) : Effect.void)),
    {
      schedule: Schedule.spaced('50 millis'),
    },
  );

const setup = Effect.fnUntraced(function* (root: string) {
  const files = yield* FileSystem.FileSystem;
  const fixture = yield* FixtureScope.acquire(root);
  const under = Effect.map(spawnedEffect(['pgrep', '-f', root], { stdin: 'ignore' }), (found) =>
    found.stdout
      .toString()
      .split('\n')
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid),
  );
  const raised: string[] = [];
  const directory = (name: string) => Effect.orDie(fixture.directory(name));
  const claimedPid = Effect.fnUntraced(function* (at?: string) {
    return Number((yield* files.readFileString(join(at ?? data, 'server.lock'))).trim());
  });
  const sweep = Effect.gen(function* () {
    for (const at of raised) {
      if (!(yield* files.exists(join(at, 'server.lock')))) continue;
      const holder = yield* claimedPid(at);
      if (Number.isInteger(holder) && holder > 0 && alive(holder)) {
        process.kill(holder, 'SIGTERM');
        yield* untilGone(holder);
      }
    }
    for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
      const standing = yield* under;
      if (standing.length === 0) return;
      for (const pid of standing) {
        try {
          process.kill(pid, signal);
        } catch {
          continue;
        }
      }
      for (const pid of standing) yield* untilGone(pid);
    }
  });
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      const released = yield* fixture.close();
      expect(released).toMatchObject({ state: 'released' });
      expect(yield* under).toEqual([]);
    }).pipe(Effect.orDie),
  );
  yield* Effect.orDie(fixture.producer('the server this file raised', sweep));
  const data = yield* directory('data');
  raised.push(data);
  const installRoot = yield* directory('install');
  const nowhere = yield* directory('nothing-installed');
  const port = yield* freePort;
  const artifactPort = yield* freePort;

  const environment = (overrides: Record<string, string>): Record<string, string> => {
    const inherited: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && !key.startsWith('TAGMA_')) inherited[key] = value;
    }
    return {
      ...inherited,
      HOME: root,
      TAGMA_DATABASE_PATH: join(data, 'tagma.sqlite'),
      TAGMA_PORT: String(port),
      TAGMA_ARTIFACT_PORT: String(artifactPort),
      TAGMA_INSTALL_ROOT: installRoot,
      ...overrides,
    };
  };

  const tagma = (argv: readonly string[], overrides: Record<string, string> = {}) => capturedEffect(argv, environment(overrides), root);
  const spawnedTagma = Effect.fnUntraced(function* (argv: readonly string[], overrides: Record<string, string> = {}) {
    const ran = yield* spawnedEffect(['bun', ENTRY, ...argv], { cwd: root, env: environment(overrides), stdin: 'ignore' });
    return { code: ran.exitCode, out: ran.stdout.toString(), err: ran.stderr.toString() };
  });

  const health = Effect.fnUntraced(function* () {
    const answered = yield* Effect.promise(() => fetch(`http://127.0.0.1:${port}/health`));
    expect(answered.ok).toBe(true);
    return (yield* Effect.promise(() => answered.json())) as { source: { cut: { startedAt: string } | null } };
  });

  const standingSince = Effect.fnUntraced(function* () {
    const body = yield* health();
    expect(body.source.cut).not.toBeNull();
    return body.source.cut?.startedAt ?? '';
  });

  const standInstallation = Effect.fnUntraced(function* (at: string, roles: ReadonlyArray<InstallationRole> = REQUIRED_ROLES) {
    const version = 'a-test-closure';
    const root = openVersion(at, version);
    const parts: InstallationPart[] = roles.map((role) => ({
      role,
      path: `parts/${role}`,
      kind: 'file' as const,
      bytes: role.length,
      digest: digestOf(new TextEncoder().encode(role)),
    }));
    yield* writeInstallation(root, { os: process.platform, arch: process.arch }, 'a test closure', parts).pipe(Effect.orDie);
    swapCurrent(at, version);
    return root;
  });

  const url = `http://127.0.0.1:${port}`;
  const started = yield* Effect.scoped(
    Effect.gen(function* () {
      const probes = yield* Queue.unbounded<void>();
      const initial = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const children: ReturnType<typeof Bun.spawn>[] = [];
      let requested = 0;
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const previous = { spawn: Bun.spawn, fetch: globalThis.fetch };
          Bun.spawn = (...args: readonly unknown[]) => {
            const [argv, options] = args;
            if (!Array.isArray(argv) || !argv.includes(ENTRY) || argv.at(-1) !== 'serve') return Reflect.apply(previous.spawn, Bun, args);
            const child = Reflect.apply(previous.spawn, Bun, [
              ['/bin/sh', '-c', 'kill -STOP $$; exec "$@"', 'start-gate', ...argv],
              options,
            ]);
            children.push(child);
            return child;
          };
          globalThis.fetch = Object.assign(
            async (...args: Parameters<typeof fetch>) => {
              if (String(args[0]) !== `${url}/health`) return previous.fetch(...args);
              const first = requested++ < 2;
              try {
                return await previous.fetch(...args);
              } catch (cause) {
                if (first) {
                  if (requested === 2) initial.resolve();
                  await initial.promise;
                } else {
                  Queue.offerUnsafe(probes, undefined);
                  await release.promise;
                }
                throw cause;
              }
            },
            { preconnect: previous.fetch.preconnect },
          );
          return previous;
        }),
        (previous) =>
          Effect.sync(() => {
            Bun.spawn = previous.spawn;
            globalThis.fetch = previous.fetch;
            release.resolve();
            for (const child of children) if (child.exitCode === null) process.kill(child.pid, 'SIGCONT');
          }),
      );
      const clients = yield* Effect.forkScoped(
        Effect.all([tagma(['web', '--no-open'], { TAGMA_SERVER_URL: url }), tagma(['web', '--no-open'], { TAGMA_SERVER_URL: url })], {
          concurrency: 2,
        }),
      );
      yield* Queue.take(probes);
      yield* Queue.take(probes);
      expect(dataDirectoryLocked(data)).toBeNull();
      for (const child of children) {
        yield* spawnedEffect(['ps', '-o', 'stat=', '-p', String(child.pid)], { stdin: 'ignore' }).pipe(
          Effect.repeat({ schedule: Schedule.spaced('10 millis'), until: (state) => state.stdout.toString().includes('T') }),
        );
      }
      const [winner, loser] = children;
      process.kill(winner!.pid, 'SIGCONT');
      yield* Effect.sync(() => dataDirectoryLocked(data)).pipe(
        Effect.repeat({ schedule: Schedule.spaced('10 millis'), until: (holder) => holder === winner!.pid }),
      );
      process.kill(loser!.pid, 'SIGCONT');
      expect(yield* Effect.promise(() => loser!.exited)).toBe(1);
      release.resolve();
      return yield* Fiber.join(clients);
    }),
  );
  return {
    started,
    root,
    raised,
    data,
    installRoot,
    nowhere,
    port,
    directory,
    claimedPid,
    tagma,
    spawnedTagma,
    standingSince,
    standInstallation,
  };
});

class Ensure extends Context.Service<Ensure, Effect.Success<ReturnType<typeof setup>>>()('testing/EnsureServer') {}
const ensureWorld = kind(Ensure, (_params: {}, home: string) => setup(home).pipe(Effect.provide(BunFileSystem.layer)));

layer(Layer.effect(Ensure, own(ensureWorld, {}, 'the server lifecycle is the subject')).pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('ensure server', (it) => {
  it.effect('while another channel runs on this Mac, neither tagma web nor tagma serve starts, and both name it and the switch', () =>
    Effect.gen(function* () {
      const { directory, tagma, spawnedTagma } = yield* Ensure;
      const files = yield* FileSystem.FileSystem;
      const home = yield* directory('other-channel');
      const data = join(home, 'data');
      const environment = {
        HOME: home,
        TAGMA_DATABASE_PATH: join(data, 'tagma.sqlite'),
        TAGMA_PORT: String(yield* freePort),
        TAGMA_ARTIFACT_PORT: String(yield* freePort),
      };
      const other = CHANNEL.id === 'dev' ? CHANNELS.stable : CHANNELS.dev;
      const url = `http://127.0.0.1:${other.port}`;
      const held = takeActive(junctionDirectory({ HOME: home })!, { channel: other.id, cli: '/nowhere', url, pid: process.pid });
      expect(held._tag).toBe('Taken');
      yield* Effect.gen(function* () {
        const web = yield* tagma(['web', '--no-open'], environment);
        expect(web.code).not.toBe(0);
        expect(web.err).toContain('channel-active');
        expect(web.err).toContain(url);
        expect(web.err).toContain(`${CHANNEL.command} switch`);
        const serve = yield* spawnedTagma(['serve'], environment);
        expect(serve.code).toBe(1);
        expect(`${serve.out}${serve.err}`).toContain('channel-active');
        expect(yield* files.exists(join(data, 'tagma.sqlite'))).toBe(false);
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (held._tag === 'Taken') held.release();
          }),
        ),
      );
    }),
  );

  it.effect('two clients racing over one explicit local address leave one server, and the loser adopts it', () =>
    Effect.gen(function* () {
      const ensure = yield* Ensure;
      const files = yield* FileSystem.FileSystem;
      const url = `http://127.0.0.1:${ensure.port}`;
      const answers = ensure.started;
      for (const answer of answers) {
        expect(answer.code, answer.err).toBe(0);
        expect(answer.out).toContain(url);
      }
      expect(answers.filter((answer) => answer.out.includes('started '))).toHaveLength(1);
      expect(answers.filter((answer) => answer.out.includes('adopted '))).toHaveLength(1);
      expect(answers.find((answer) => answer.out.includes('started '))?.out).toContain(join(ensure.data, 'serve.log'));
      expect(yield* files.exists(join(ensure.data, 'serve.log'))).toBe(true);
      expect(alive(yield* ensure.claimedPid())).toBe(true);
    }),
  );

  it.effect('a second client adopts the process that stands and names the cut it adopted', () =>
    Effect.gen(function* () {
      const ensure = yield* Ensure;
      const holder = yield* ensure.claimedPid();
      const before = yield* ensure.standingSince();
      const again = yield* ensure.tagma(['web', '--no-open']);
      expect(again.code).toBe(0);
      expect(again.out).toContain(`adopted http://127.0.0.1:${ensure.port}`);
      expect(yield* ensure.standingSince()).toBe(before);
      expect(yield* ensure.claimedPid()).toBe(holder);
    }),
  );

  it.effect('tagma serve over the standing server refuses by the claim and names the holder', () =>
    Effect.gen(function* () {
      const ensure = yield* Ensure;
      const holder = yield* ensure.claimedPid();
      const refused = yield* ensure.spawnedTagma(['serve']);
      expect(refused.code).toBe(1);
      expect(refused.err).toMatch(new RegExp(`\\b${holder}\\b`));
      expect(refused.err).toContain('TAGMA_DATABASE_PATH');
    }),
  );

  it.effect('tagma desktop refuses no-installation where nothing is installed', () =>
    Effect.gen(function* () {
      const { nowhere, tagma } = yield* Ensure;
      const refused = yield* tagma(['desktop', '--no-open'], { TAGMA_INSTALL_ROOT: nowhere });
      expect(refused.code).toBe(2);
      expect(refused.err).toContain('refused[no-installation]');
    }),
  );

  it.effect('tagma desktop names the application the installation that stands carries', () =>
    Effect.gen(function* () {
      const ensure = yield* Ensure;
      const files = yield* FileSystem.FileSystem;
      yield* ensure.standInstallation(ensure.installRoot);
      const application = join(ensure.installRoot, CURRENT, 'desktop', hostBundle('Tagma Dev'));

      const damaged = yield* ensure.tagma(['desktop', '--no-open']);
      expect(damaged.code).toBe(2);
      expect(damaged.err).toContain('refused[no-application-bundle]');

      yield* files.makeDirectory(application, { recursive: true });
      const named = yield* ensure.tagma(['desktop', '--no-open']);
      expect(named.code).toBe(0);
      expect(named.out).toContain(application);
      expect(named.out).toContain(`adopted http://127.0.0.1:${ensure.port}`);
    }),
  );

  it.effect('a standing installation whose manifest will not be read refuses as broken, not as none at all', () =>
    Effect.gen(function* () {
      const ensure = yield* Ensure;
      const damaged = yield* ensure.directory('damaged-install');
      yield* ensure.standInstallation(
        damaged,
        REQUIRED_ROLES.filter((role) => role !== 'runtime'),
      );
      const refused = yield* ensure.tagma(['desktop', '--no-open'], { TAGMA_INSTALL_ROOT: damaged });
      expect(refused.code).toBe(2);
      expect(refused.err).toContain('refused[installation-refused]');
    }),
  );

  it.effect('an address this local start cannot bind refuses without replacing the standing server', () =>
    Effect.gen(function* () {
      const ensure = yield* Ensure;
      const elsewhere = yield* freePort;
      const refused = yield* ensure.tagma(['web', '--no-open'], { TAGMA_SERVER_URL: `http://127.0.0.1:${elsewhere}` });
      expect(refused.code).toBe(2);
      expect(refused.err).toContain('refused[server-elsewhere]');
      expect(refused.err).toContain(`http://127.0.0.1:${ensure.port}`);
    }),
  );

  it.effect('a server that could not come up refuses server-not-up and names its log and the start it left under', () =>
    Effect.gen(function* () {
      const ensure = yield* Ensure;
      const files = yield* FileSystem.FileSystem;
      const unbindable = yield* ensure.directory('unbindable');
      ensure.raised.push(unbindable);
      const artifactSpare = yield* freePort;
      const taken = yield* Effect.acquireRelease(
        Effect.sync(() => Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('not tagma', { status: 404 }) })),
        (listening) => Effect.promise(() => listening.stop(true)),
      );
      const refused = yield* ensure.tagma(['web', '--no-open'], {
        TAGMA_DATABASE_PATH: join(unbindable, 'tagma.sqlite'),
        TAGMA_PORT: String(taken.port),
        TAGMA_ARTIFACT_PORT: String(artifactSpare),
      });
      expect(refused.code).toBe(2);
      expect(refused.err).toContain('refused[server-not-up]');
      expect(refused.err).toContain(join(unbindable, 'serve.log'));
      const stamp = /under the start of (\S+)/.exec(refused.err)?.[1];
      expect(stamp).toBeDefined();
      expect(yield* files.readFileString(join(unbindable, 'serve.log'))).toContain(`=== tagma serve started ${stamp}`);
    }),
  );

  it.effect('tagma restart over the standing server brings its successor up and names it', () =>
    Effect.gen(function* () {
      const ensure = yield* Ensure;
      const leaving = yield* ensure.claimedPid();
      const before = yield* ensure.standingSince();
      const restarted = yield* ensure.tagma(['restart']);
      expect(restarted.code, restarted.err).toBe(0);
      expect(restarted.out).toContain(`restarted http://127.0.0.1:${ensure.port}`);
      expect(yield* ensure.standingSince()).not.toBe(before);
      expect(yield* ensure.claimedPid()).not.toBe(leaving);
      expect(alive(yield* ensure.claimedPid())).toBe(true);
    }),
  );
});
