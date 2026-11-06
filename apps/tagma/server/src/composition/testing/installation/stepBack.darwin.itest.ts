import { Database } from 'bun:sqlite';
import { expect } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { Effect, Layer, Schedule } from 'effect';
import { endHosts } from '../../../executions/testing/doubles.js';
import { partsAt } from '../../../installation/closure/read.js';
import { writeInstallation } from '../../../installation/closure/write.js';
import { ServerLaunch } from '../../../installation/process/launch.js';
import { Processes } from '@runlith/execution-host/ProcessReader';
import { CHANNELS } from '../../../installation/contract/wire/channel.js';
import { type InstallationRole, MIGRATIONS, SERVER_ENTRY } from '../../../installation/contract/wire/manifest.js';
import { testProcesses } from '../../../installation/testing/processes.js';
import { swapCurrent } from '../../../platform/lock/versionedDirectories.js';
import { GRAPH_STEPS } from '../../../graph/steps/sequence.js';
import { ENTRY_KINDS } from '../composed.js';
import { checkoutInstalled, LEAVING_MIGRATION, leavingCopy } from './installed.js';
import { freePorts, healthAt, op, served, servingBuild, worldEnv } from './serving.js';

const STEPS = ENTRY_KINDS.steps.map((step) => step.name);
const NEWEST = STEPS.at(-1)!;
const PREVIOUS = STEPS.at(-2)!;
const UNKNOWN_STEP = `${NEWEST.slice(0, -1)}${NEWEST.endsWith('z') ? 'y' : 'z'}`;
const GRAPH_NEWEST = GRAPH_STEPS.at(-1)!.id;
const UNKNOWN_GRAPH = `${GRAPH_NEWEST.slice(0, -1)}${GRAPH_NEWEST.endsWith('z') ? 'y' : 'z'}`;
const BROKEN_MIGRATION = '29991231000001_cannot_apply';

const wrote = (path: string, text: string): void => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
};

const mark = (path: string, threadId: string): string | null => {
  const db = new Database(path, { readonly: true });
  try {
    return (
      db.query<{ step: string | null }, [string]>('select step from thread_rollout_form where thread_id = ?').get(threadId)?.step ?? null
    );
  } finally {
    db.close();
  }
};

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

const stepBackWorld = Effect.fnUntraced(function* () {
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
  const landed = yield* checkoutInstalled(root, { ...CHANNELS.dev, name: 'dev' });
  const before = landed.version;
  const beforeBuild = landed.manifest.identity.build;
  const { version: leaving, root: leavingRoot, build: leavingBuild } = yield* leavingCopy(landed, `leaving ${beforeBuild}`);

  const patched = landed.manifest.parts.filter(
    (part) =>
      part.kind === 'file' &&
      part.path.startsWith('bin/') &&
      /\.(js|ts)$/u.test(part.path) &&
      [NEWEST, GRAPH_NEWEST].some((step) => readFileSync(join(landed.root, part.path), 'utf8').includes(step)),
  );
  expect(patched.map((part) => part.path)).toContain(SERVER_ENTRY);
  for (const part of patched)
    writeFileSync(
      join(landed.root, part.path),
      readFileSync(join(landed.root, part.path), 'utf8').replaceAll(NEWEST, UNKNOWN_STEP).replaceAll(GRAPH_NEWEST, UNKNOWN_GRAPH),
    );
  const repatched = yield* Effect.forEach(patched, (part) => partsAt(landed.root, part.role as InstallationRole, part.path));
  yield* writeInstallation(landed.root, landed.manifest.platform, beforeBuild, [
    ...landed.manifest.parts.filter((part) => !patched.includes(part)),
    ...repatched.flat(),
  ]);
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
  return { root, data, install, log, landed, before, beforeBuild, leaving, leavingRoot, leavingBuild, origin, env, store };
});

it.live(
  'a step back through the door returns the data a migration of the leaving build changed, restarts onto the frozen-strict installation before it and serves there, keeps what the user wrote, and goes forward again; a back that cannot carry leaves the leaving build serving and says why',
  () =>
    Effect.gen(function* () {
      const { root, install, log, landed, before, beforeBuild, leaving, leavingRoot, leavingBuild, origin, env, store } =
        yield* stepBackWorld();
      served(leavingRoot, env, log);
      yield* servingBuild(origin, leavingBuild);
      expect(ledger(store)).toContain(LEAVING_MIGRATION);
      const checkout = join(root, 'project');
      mkdirSync(checkout, { recursive: true });
      const added = yield* op(origin, 'add_project', { name: 'tools', rootPath: checkout, storage: 'stealth' });
      const projectId = (added.body as { project: { id: number } }).project.id;
      expect(yield* op(origin, 'save_console_key', { provider: 'muse', key: 'step-back' })).toMatchObject({ status: 200 });
      const born = yield* op(origin, `create_thread?project=${projectId}`, { approvalMode: 'trust' });
      expect(born).toMatchObject({ status: 200, body: { snapshot: { thread: { id: expect.any(String) } } } });
      const threadId = (born.body as { snapshot: { thread: { id: string } } }).snapshot.thread.id;
      expect(mark(store, threadId)).toBe(NEWEST);
      const offered = yield* op(origin, 'read_machine_state', {});
      expect(
        (offered.body.machine as { server: { next: { back: { readOnlyGraphs?: readonly string[] } | null } } }).server.next.back
          ?.readOnlyGraphs,
      ).toContain('tools');
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
      expect(mark(store, threadId)).toBe(PREVIOUS);
      expect(readFileSync(log, 'utf8')).toContain(`the form steps ${NEWEST} declare no way back`);
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

it.live(
  'under a launch owner a step back through the door returns the data and the owner raises the installation before it, which serves and stops with the owner',
  () =>
    Effect.gen(function* () {
      const { install, log, before, beforeBuild, leavingRoot, leavingBuild, origin, env, store } = yield* stepBackWorld();
      const launch = new ServerLaunch(
        [join(leavingRoot, 'bun'), '--no-install', join(leavingRoot, 'bin/cli/main.js'), 'serve'],
        env,
        log,
        yield* Processes,
      );
      yield* Effect.addFinalizer(() => Effect.promise(() => launch.stop()));
      yield* servingBuild(origin, leavingBuild);
      expect(ledger(store)).toContain(LEAVING_MIGRATION);

      expect((yield* op(origin, 'install_next', { offer: 'back', then: 'restart' })).status).toBe(200);
      yield* servingBuild(origin, beforeBuild);

      expect(readlinkSync(join(install, 'current'))).toBe(before);
      expect(ledger(store)).not.toContain(LEAVING_MIGRATION);
      yield* Effect.repeat(
        Effect.sync(() => [existsSync(join(install, 'attempt.json')), existsSync(join(install, 'back.json')), existsSync(`${store}.back`)]),
        { until: (left) => left.every((one) => !one), schedule: Schedule.spaced('100 millis') },
      );
      yield* Effect.promise(() => launch.stop());
      expect(yield* healthAt(origin)).toBeNull();
    }).pipe(Effect.provide(Layer.merge(BunFileSystem.layer, testProcesses))),
);
