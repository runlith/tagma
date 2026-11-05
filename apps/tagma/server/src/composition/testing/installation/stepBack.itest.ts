import { Database } from 'bun:sqlite';
import { expect } from 'bun:test';
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { it } from '@runlith/effect-test';
import { gitLayer } from '@runlith/git/Git';
import { Effect, FileSystem, Layer, Schedule } from 'effect';
import { releaseInstallation } from '../../../cut/release.js';
import { inertPlatform } from '../../../cut/testing/platform.js';
import { endHosts } from '../../../executions/testing/doubles.js';
import { partsAt } from '../../../installation/closure/read.js';
import { writeInstallation } from '../../../installation/closure/write.js';
import { CHANNELS } from '../../../installation/contract/wire/channel.js';
import { MIGRATIONS } from '../../../installation/contract/wire/manifest.js';
import { testProcesses } from '../../../installation/testing/processes.js';
import { openVersion, swapCurrent } from '../../../platform/lock/versionedDirectories.js';
import { DEVELOPER } from '../../developer/build.js';

const spawning = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));
const machine = Layer.mergeAll(BunFileSystem.layer, spawning, gitLayer.pipe(Layer.provide(spawning)));

const LEAVING_MIGRATION = '29991231000000_only_the_leaving_build';
const LEAVING_SQL =
  'ALTER TABLE `meta` ADD `only_leaving` text;--> statement-breakpoint\nCREATE TABLE `only_leaving` (`id` integer PRIMARY KEY);';
const BROKEN_MIGRATION = '29991231000001_cannot_apply';

const wrote = (path: string, text: string): void => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
};

const freePorts = () => {
  const listeners = Array.from({ length: 4 }, () => Bun.serve({ port: 0, fetch: () => new Response('') }));
  const ports = listeners.map((listener) => listener.port!);
  for (const listener of listeners) listener.stop(true);
  return ports as [number, number, number, number];
};

const worldEnv = (root: string, data: string, ports: readonly [number, number, number, number]): Record<string, string | undefined> => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('TAGMA_'))),
  HOME: join(root, 'home'),
  TAGMA_DATABASE_PATH: join(data, 'tagma.sqlite'),
  TAGMA_SEED_DIRECTORY: join(root, 'seeds'),
  TAGMA_INSTALL_ROOT: join(root, 'install'),
  TAGMA_PORT: String(ports[0]),
  TAGMA_ARTIFACT_PORT: String(ports[1]),
  TAGMA_SANDBOX_PORT: String(ports[2]),
  TAGMA_REMOTE_PORT: String(ports[3]),
  TAGMA_SQLITE_READERS: '1',
});

const served = (release: string, env: Record<string, string | undefined>, log: string) => {
  const sink = openSync(log, 'a');
  const child = Bun.spawn([join(release, 'bun'), '--no-install', join(release, 'bin/cli/main.js'), 'serve'], {
    env,
    stdin: 'ignore',
    stdout: sink,
    stderr: sink,
    detached: true,
  });
  closeSync(sink);
  return child;
};

type Health = { readonly source: { readonly installation: { readonly build: string } | null } };

const healthAt = (origin: string): Effect.Effect<Health | null> =>
  Effect.promise(() =>
    fetch(`${origin}/health`)
      .then((answer) => (answer.status === 200 ? (answer.json() as Promise<Health>) : null))
      .catch(() => null),
  );

const servingBuild = (origin: string, build: string) =>
  Effect.repeat(healthAt(origin), {
    until: (health) => health?.source.installation?.build === build,
    schedule: Schedule.spaced('100 millis'),
  });

const op = (origin: string, id: string, input: object) =>
  Effect.promise(async () => {
    const answer = await fetch(`${origin}/api/op/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    return { status: answer.status, body: (await answer.json()) as Record<string, unknown> };
  });

const ledger = (path: string): readonly string[] => {
  const db = new Database(path, { readonly: true });
  try {
    return db
      .query<{ name: string }, []>('select name from __drizzle_migrations')
      .all()
      .map((row) => row.name);
  } finally {
    db.close();
  }
};

it.live(
  'a step back through the door returns the data a migration of the leaving build changed, restarts onto the frozen-strict installation before it and serves there, keeps what the user wrote, and goes forward again; a back that cannot carry leaves the leaving build serving and says why',
  () =>
    Effect.gen(function* () {
      const root = realpathSync(
        yield* Effect.sync(() =>
          Bun.spawnSync(['mktemp', '-d', join(tmpdir(), 'step-back-XXXXXX')])
            .stdout.toString()
            .trim(),
        ),
      );
      const data = join(root, 'data');
      mkdirSync(data, { recursive: true });
      const install = join(root, 'install');
      const log = join(data, 'serve.log');
      const desktop = join(root, 'desktop');
      const app = join(root, 'app');
      wrote(join(desktop, 'package.json'), '{"name":"@tagma/desktop"}\n');
      wrote(
        join(desktop, 'scripts/build-host.ts'),
        `import { mkdirSync, writeFileSync } from 'node:fs';\nconst out = process.env.TAGMA_HOST_OUT!;\nmkdirSync(out + '/dev.app', { recursive: true });\nwriteFileSync(out + '/dev.app/dev', '');\n`,
      );
      wrote(
        join(app, 'package.json'),
        '{"name":"@tagma/app","scripts":{"build":"mkdir -p \\"$TAGMA_SURFACE_OUT\\" && echo ok > \\"$TAGMA_SURFACE_OUT/index.html\\""}}\n',
      );
      const { modules } = yield* Effect.promise(() => DEVELOPER.parts());
      const landed = yield* releaseInstallation(
        install,
        join(root, 'bin/tagma'),
        { HOME: join(root, 'home'), SHELL: '/bin/zsh', PATH: process.env.PATH },
        {
          ...DEVELOPER.cut,
          channel: { ...CHANNELS.dev, name: 'dev' },
          client: { root: app, config: null },
          roots: { ...DEVELOPER.cut.roots, desktop },
          platform: {
            ...inertPlatform,
            signer: Effect.succeed({ fingerprint: '-', name: 'test', created: false }),
            notice: () => 'unsigned',
          },
          steps: { graph: [], journal: [] },
          stores: modules.flatMap((module) => module.stores ?? []),
          processes: testProcesses,
        },
        null,
      ).pipe(Effect.provide(machine));
      const before = landed.version;
      const beforeBuild = landed.manifest.identity.build;

      const leaving = `${before}-leaving`;
      const leavingRoot = openVersion(install, leaving);
      rmSync(leavingRoot, { recursive: true, force: true });
      cpSync(landed.root, leavingRoot, { recursive: true, verbatimSymlinks: true });
      wrote(join(leavingRoot, MIGRATIONS, LEAVING_MIGRATION, 'migration.sql'), LEAVING_SQL);
      const leavingBuild = `leaving ${beforeBuild}`;
      const carried = yield* partsAt(leavingRoot, 'migrations', join(MIGRATIONS, LEAVING_MIGRATION, 'migration.sql'));
      yield* writeInstallation(leavingRoot, landed.manifest.platform, leavingBuild, [...landed.manifest.parts, ...carried]);
      swapCurrent(install, leaving);

      const ports = freePorts();
      const origin = `http://127.0.0.1:${ports[0]}`;
      const env = worldEnv(root, data, ports);
      const store = join(data, 'tagma.sqlite');
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          const state = yield* Effect.promise(() =>
            fetch(`${origin}/api/op/read_machine_state`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
              .then((answer) => answer.json() as Promise<{ machine?: { server?: { pid?: number } } }>)
              .catch(() => null),
          );
          const pid = state?.machine?.server?.pid;
          if (pid !== undefined) process.kill(pid, 'SIGTERM');
          yield* endHosts(root).pipe(Effect.orDie);
          rmSync(root, { recursive: true, force: true });
        }),
      );

      served(leavingRoot, env, log);
      yield* servingBuild(origin, leavingBuild);
      expect(ledger(store)).toContain(LEAVING_MIGRATION);
      const writing = new Database(store);
      writing.run(`INSERT INTO meta (key, value) VALUES ('users-work', 'kept')`);
      writing.close();

      const asideData = join(root, 'aside');
      mkdirSync(asideData, { recursive: true });
      const snapshot = new Database(store, { readonly: true });
      snapshot.run(`VACUUM INTO '${join(asideData, 'tagma.sqlite')}'`);
      snapshot.close();
      const strict = served(landed.root, worldEnv(join(root, 'aside-home'), asideData, freePorts()), join(asideData, 'serve.log'));
      expect(yield* Effect.promise(() => strict.exited)).not.toBe(0);
      expect(readFileSync(join(asideData, 'serve.log'), 'utf8')).toContain('absent from the shipped chain');

      wrote(join(landed.root, MIGRATIONS, BROKEN_MIGRATION, 'migration.sql'), 'THIS IS NOT SQL');
      const refused = yield* op(origin, 'install_next', { offer: 'back', then: 'restart' });
      expect(refused.status).toBe(200);
      const restarted = yield* Effect.repeat(
        op(origin, 'read_machine_state', {}).pipe(
          Effect.catchDefect(() => Effect.succeed({ status: 0, body: {} as Record<string, unknown> })),
        ),
        {
          until: (answer) => {
            const server = (
              answer.body.machine as
                | { server?: { next?: { installed?: { outcome?: string; since?: string } }; installation?: { build?: string } } }
                | undefined
            )?.server;
            return answer.status === 200 && server?.next?.installed?.outcome === 'failed';
          },
          schedule: Schedule.spaced('100 millis'),
        },
      );
      expect((restarted.body.machine as { server: { installation: { build: string } } }).server.installation.build).toBe(leavingBuild);
      expect(readlinkSync(join(install, 'current'))).toBe(leaving);
      expect(ledger(store)).toContain(LEAVING_MIGRATION);
      rmSync(join(landed.root, MIGRATIONS, BROKEN_MIGRATION), { recursive: true, force: true });

      const asked = yield* op(origin, 'install_next', { offer: 'back', then: 'restart' });
      expect(asked.status).toBe(200);
      yield* servingBuild(origin, beforeBuild);

      expect(readlinkSync(join(install, 'current'))).toBe(before);
      expect(ledger(store)).not.toContain(LEAVING_MIGRATION);
      const returned = new Database(store, { readonly: true });
      expect(returned.query(`select value from meta where key = 'users-work'`).get()).toEqual({ value: 'kept' });
      expect(returned.query(`select name from pragma_table_info('meta') where name = 'only_leaving'`).all()).toEqual([]);
      expect(returned.query(`select name from sqlite_master where name = 'only_leaving'`).all()).toEqual([]);
      returned.close();
      yield* Effect.repeat(
        Effect.sync(() => [existsSync(join(install, 'attempt.json')), existsSync(join(install, 'back.json')), existsSync(`${store}.back`)]),
        { until: (left) => left.every((one) => !one), schedule: Schedule.spaced('100 millis') },
      );
      expect(JSON.parse(readFileSync(join(install, 'returned.json'), 'utf8'))).toEqual({ left: leavingBuild, to: before });
      expect(basename(realpathSync(join(install, 'current')))).toBe(before);
      const state = yield* op(origin, 'read_machine_state', {});
      expect(state.status).toBe(200);

      swapCurrent(install, leaving);
      expect((yield* op(origin, 'restart_server', {})).status).toBe(200);
      yield* servingBuild(origin, leavingBuild);
      expect(ledger(store)).toContain(LEAVING_MIGRATION);
      const forward = new Database(store, { readonly: true });
      expect(forward.query(`select value from meta where key = 'users-work'`).get()).toEqual({ value: 'kept' });
      forward.close();
    }).pipe(Effect.provide(BunFileSystem.layer)),
);
