import { MachineUnits } from '../../platform/contract/service/units.js';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { ProjectLifecycle, ProjectPolicy } from '../../graph/contract/service/serving.js';
import { testSessionIdentityLayer } from '../../platform/testing/identity.js';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Effect, Layer } from 'effect';
import { eq } from 'drizzle-orm';
import { MachineStore } from '../../platform/contract/service/store.js';
import { unitsLayer } from '../../platform/store/units.js';
import { machineFileLayer } from '../../platform/store/open.js';
import { setting } from '../../settings/store/table.js';
import { projectsWithPolicy } from '../../graph/store/policy.js';
import { projectsLayer } from '../../projects/registration.js';
import { fixtureGraph } from '../../composition/testing/fixtureGraph.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { dumpMachineRegistry, readRegistry } from './file.js';
import { machineStoreLayer } from './restore.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { registryExportLayer } from './export.js';

const based = (prefix: string) =>
  Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), prefix))),
    (base) => Effect.sync(() => rmSync(base, { recursive: true, force: true })),
  );

const opened = (dbPath: string, base: string) =>
  Layer.mergeAll(
    registryExportLayer.pipe(
      Layer.provide(unitsLayer(MachineUnits, MachineStore)),
      Layer.provideMerge(fixtureGraph({ sourcePath: base }).pipe(Layer.provideMerge(projectsLayer))),
    ),
    unitsLayer(MachineUnits, MachineStore),
  )
    .pipe(Layer.provideMerge(machineStoreLayer(dbPath, fixtureMigrations, sharedPool)))
    .pipe(Layer.provideMerge(testSessionIdentityLayer));

const early = (rootPath: string, createdAt: string) => ({
  id: 1,
  name: 'early',
  repoKey: rootPath,
  rootPath,
  strictProvenance: false,
  private: false,
  global: false,
  storage: 'plain',
  createdAt,
});

it.live('a project registered, the database deleted, the registry reseeds it with its id', () =>
  Effect.gen(function* () {
    const base = yield* based('registry-');
    const dbPath = join(base, 'tagma.sqlite');
    const born = yield* Effect.flatMap(ProjectLifecycle, (births) =>
      births.create({ name: 'registry-demo', rootPath: base, storage: 'stealth' }),
    ).pipe(Effect.provide(opened(dbPath, base)));
    expect(existsSync(join(base, 'registry.json'))).toBe(true);

    for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true });
    const revived = yield* Effect.gen(function* () {
      const rows = yield* Effect.flatMap(Projects, (projects) => projects.list());
      const policies = yield* Effect.flatMap(ProjectPolicy, (policy) => policy.read([born.id]));
      return { id: rows.find((row) => row.name === 'registry-demo')?.id, storage: policies.get(born.id)?.storage };
    }).pipe(Effect.provide(opened(dbPath, base)));
    expect(revived).toEqual({ id: born.id, storage: 'stealth' });
  }),
);

it.live('a registry whose lowest id is not the cross-project row still revives whole', () =>
  Effect.gen(function* () {
    const base = yield* based('registry-order-');
    const rootPath = join(base, 'a-repository');
    mkdirSync(rootPath);
    writeFileSync(
      join(base, 'registry.json'),
      `${JSON.stringify({ projects: [early(rootPath, '2026-01-01T00:00:00.000Z')], settings: [] }, null, 2)}\n`,
    );
    const rows = yield* Effect.flatMap(Projects, (projects) => projects.list()).pipe(
      Effect.provide(opened(join(base, 'tagma.sqlite'), base)),
    );
    expect(rows.find((row) => row.name === 'early')?.id).toBe(1);
    const cross = rows.find((row) => row.global);
    expect(cross).toBeDefined();
    expect(cross?.id).not.toBe(1);
  }),
);

it.live('a setting row the standing database deleted stays deleted across a restart whose registry still holds it', () =>
  Effect.gen(function* () {
    const base = yield* based('registry-stale-');
    const dbPath = join(base, 'tagma.sqlite');
    const terminalKeys = (keys: readonly string[]) => keys.filter((key) => key.startsWith('terminal.')).sort();
    const registryKeys = () =>
      terminalKeys(
        (JSON.parse(readFileSync(join(base, 'registry.json'), 'utf8')) as { settings: { key: string }[] }).settings.map((row) => row.key),
      );
    yield* Effect.gen(function* () {
      const { db } = yield* MachineStore;
      const now = new Date(yield* Clock.currentTimeMillis);
      yield* db.insert(setting).values([
        { scope: 'user', key: 'terminal.tabLayouts', value: '{}', updatedAt: now },
        { scope: 'user', key: 'terminal.placeLayouts', value: '{}', updatedAt: now },
      ]);
      yield* dumpMachineRegistry();
    }).pipe(Effect.provide(opened(dbPath, base)));

    yield* Effect.flatMap(MachineStore, ({ db }) => db.delete(setting).where(eq(setting.key, 'terminal.tabLayouts'))).pipe(
      Effect.provide(Layer.orDie(machineFileLayer(dbPath, fixtureMigrations, {}, sharedPool))),
    );
    expect(registryKeys()).toEqual(['terminal.placeLayouts', 'terminal.tabLayouts']);

    const held = yield* Effect.flatMap(MachineStore, ({ db }) => db.select({ key: setting.key }).from(setting)).pipe(
      Effect.provide(opened(dbPath, base)),
    );
    expect(terminalKeys(held.map((row) => row.key))).toEqual(['terminal.placeLayouts']);
    expect(registryKeys()).toEqual(['terminal.placeLayouts']);
  }),
);

it.live('a registry recreates a lost database at the shipped baseline and retains current settings', () =>
  Effect.gen(function* () {
    const base = yield* based('registry-chain-');
    const rootPath = join(base, 'a-repository');
    mkdirSync(rootPath);
    const at = '2026-09-21T00:00:00.000Z';
    writeFileSync(
      join(base, 'registry.json'),
      `${JSON.stringify({
        projects: [early(rootPath, at)],
        settings: [
          { id: 1, scope: 'user', key: 'threads.idleProjectionDays', projectId: null, value: '9', declined: false, updatedAt: at },
          { id: 2, scope: 'user', key: 'terminal.placeLayouts', projectId: null, value: '{}', declined: false, updatedAt: at },
        ],
      })}\n`,
    );
    const { held, rows, policies } = yield* Effect.gen(function* () {
      const held = yield* Effect.flatMap(MachineStore, ({ db }) => db.select({ key: setting.key, value: setting.value }).from(setting));
      const rows = yield* Effect.flatMap(Projects, (projects) => projects.list());
      const policies = yield* Effect.flatMap(MachineStore, ({ db }) => projectsWithPolicy(db));
      return { held, rows, policies };
    }).pipe(Effect.provide(opened(join(base, 'tagma.sqlite'), base)));
    expect(held.filter((row) => /^(threads|terminal)\./.test(row.key))).toEqual([
      { key: 'threads.idleProjectionDays', value: '9' },
      { key: 'terminal.placeLayouts', value: '{}' },
    ]);
    expect(rows.find((row) => row.name === 'early')?.id).toBe(1);
    expect(policies.find((row) => row.id === 1)?.storage).toBe('stealth');
  }),
);

it.live('a registry file that is not one is a typed refusal naming the file, never a defect', () =>
  Effect.gen(function* () {
    const base = yield* based('registry-');
    const path = join(base, 'registry.json');
    writeFileSync(path, '{not json');
    const notJson = yield* Effect.flip(readRegistry(path));
    expect(notJson._tag).toBe('RegistryUnreadable');
    expect(notJson.path).toBe(path);
    writeFileSync(path, JSON.stringify({ projects: 'none' }));
    expect((yield* Effect.flip(readRegistry(path)))._tag).toBe('RegistryUnreadable');
    expect((yield* Effect.flip(readRegistry(join(base, 'absent.json'))))._tag).toBe('RegistryUnreadable');
  }),
);
