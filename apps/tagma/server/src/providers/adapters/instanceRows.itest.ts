import { afterAll, expect } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { layer } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { seededStoreLayer } from '../../platform/store/open.js';
import { unitsLayer } from '../../platform/store/units.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { adapterInstance } from '../store/tables.js';
import { makeConsoleKeyStore } from '../credentials/consoleKeys.js';
import { consoleKeyFile } from '../credentials/consoleKeyFile.js';
import { instanceFile } from '../credentials/instanceFile.js';
import { makeAdapterInstanceRows } from './instanceRows.js';

const directory = await mkdtemp(join(tmpdir(), 'adapter-instance-'));
afterAll(() => rm(directory, { recursive: true, force: true }));

const rows = Effect.map(Effect.all([MachineStore, MachineUnits]), ([store, units]) =>
  makeAdapterInstanceRows({ db: store.db, units, file: instanceFile(directory) }),
);

layer(
  unitsLayer(MachineUnits, MachineStore).pipe(
    Layer.provideMerge(Layer.orDie(seededStoreLayer(MachineStore, fixtureMigrations, {}, sharedPool))),
  ),
)('adapter instance rows', (it) => {
  it.effect(
    'public rows and their named secrets publish together, reopening preserves their association, and stale revisions cannot overwrite either',
    () =>
      Effect.gen(function* () {
        const store = yield* rows;
        const first = yield* store.save(
          'fixture',
          { id: 'endpoint', values: { rows: [{ id: 'a' }, { id: 'b' }] } },
          { rows: [{ password: 'first' }, { password: 'second' }] },
        );
        const next = yield* store.save(
          'fixture',
          { id: first.id, revision: first.revision, values: { rows: [{ id: 'b' }] } },
          { rows: [{ password: 'second' }] },
        );
        const reopened = yield* rows;
        expect((yield* reopened.read()).instances.get('fixture')).toEqual([next]);
        expect((yield* reopened.read()).secrets.endpoint).toEqual({ rows: [{ password: 'second' }] });
        expect(yield* Effect.flip(reopened.save('fixture', first, { rows: [{ password: 'wrong' }] }))).toMatchObject({
          code: 'stale-instance',
        });
        const filed = JSON.parse(yield* Effect.promise(() => readFile(join(directory, 'adapter-settings.json'), 'utf8')));
        expect(filed.endpoint).toMatchObject({
          values: next.values,
          secrets: { rows: [{ password: 'second' }] },
          revision: next.revision,
        });
        yield* reopened.remove('fixture', first.id);
        const removed = yield* reopened.read();
        expect(removed.instances.size).toBe(0);
        expect(removed.secrets).toEqual({});
      }),
  );

  it.effect('boot moves database instances and their console keys in one recoverable document update, then retires their source rows', () =>
    Effect.gen(function* () {
      const [store, units] = yield* Effect.all([MachineStore, MachineUnits]);
      const keys = makeConsoleKeyStore({ db: store.db, units, file: consoleKeyFile(directory) });
      const values = { name: 'Moved endpoint' };
      yield* units.write(writes('fixture.instances', [adapterInstance]), (unit) =>
        Effect.asVoid(
          unit.run(
            store.db
              .insert(adapterInstance)
              .values({ id: 'moved', adapter: 'fixture', settings: JSON.stringify(values), createdAt: new Date() }),
          ),
        ),
      );
      yield* keys.save('moved', 'existing-key');
      const instances = yield* rows;
      yield* Effect.addFinalizer(() => instances.remove('fixture', 'moved').pipe(Effect.orDie));
      yield* instances.moveSecrets(keys);
      const moved = yield* instances.read();
      expect(moved.instances.get('fixture')?.[0]).toMatchObject({ id: 'moved', values });
      expect(moved.secrets.moved).toEqual({ key: 'existing-key' });
      expect(yield* keys.accounts('moved')).toEqual([]);
      expect(yield* units.read((unit) => unit.run(store.db.select().from(adapterInstance).all()))).toEqual([]);
      yield* instances.moveSecrets(keys);
      expect((yield* instances.read()).secrets.moved).toEqual({ key: 'existing-key' });
    }),
  );
});
