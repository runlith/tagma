import { randomUUID } from 'node:crypto';
import type { SettingInstance, SettingRow } from '@runlith/tagma/adapter/provider';
import type { CredentialFile } from '@runlith/credential-file/CredentialFile';
import { instanceSnapshot, type InstanceDocument } from '../credentials/instanceFile.js';
import type { ConsoleKeyStore } from '../credentials/consoleKeys.js';
import { inArray } from 'drizzle-orm';
import { Effect, Schema } from 'effect';
import { adapterInstance } from '../store/tables.js';
import type { StoreDb } from '../../platform/contract/service/store.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { settingValuesSchema } from '../contract/wire/catalog.js';

const decodeValues = Schema.decodeUnknownEffect(Schema.fromJsonString(settingValuesSchema));

export const makeAdapterInstanceRows = (input: {
  readonly db: StoreDb<'machine'>;
  readonly units: MachineUnits['Service'];
  readonly file: CredentialFile<InstanceDocument>;
}) => {
  const { db, units, file } = input;

  const read = () => Effect.map(file.read(), instanceSnapshot);
  const moveSecrets = Effect.fnUntraced(function* (keys: ConsoleKeyStore) {
    const stored = yield* units.read((unit) => unit.run(db.select().from(adapterInstance).all()));
    const current = yield* file.read();
    const ids = [...new Set([...Object.keys(current), ...stored.map((row) => row.id)])];
    const keyed = yield* keys.values(ids);
    const moved: Record<string, InstanceDocument[string]> = {};
    for (const row of stored) {
      const values = yield* decodeValues(row.settings).pipe(
        Effect.mapError(
          (cause) =>
            new GateRefusal('instance-invalid', `The saved instance ${row.id} cannot be read: ${cause.message}`, [
              'repair its settings before starting the providers',
            ]),
        ),
      );
      moved[row.id] = {
        adapter: row.adapter,
        createdAt: row.createdAt.getTime(),
        revision: randomUUID(),
        values: values as SettingRow,
        secrets: keyed[row.id] === undefined ? {} : { key: keyed[row.id] },
      };
    }
    if (stored.length > 0) {
      yield* file.update((document) => Effect.succeed({ ...moved, ...document }));
      yield* units.write(writes('AdapterInstanceRows.moveSecrets', [adapterInstance]), (unit) =>
        Effect.asVoid(
          unit.run(
            db.delete(adapterInstance).where(
              inArray(
                adapterInstance.id,
                stored.map((row) => row.id),
              ),
            ),
          ),
        ),
      );
    }
    yield* keys.removeProviders(ids.filter((id) => keyed[id] !== undefined));
  });
  const save = (adapter: string, instance: SettingInstance, secrets: SettingRow) => {
    const revision = randomUUID();
    return Effect.as(
      file.update((document) => {
        const standing = document[instance.id];
        if (
          (standing === undefined && instance.revision !== undefined) ||
          (standing !== undefined && (standing.adapter !== adapter || instance.revision !== standing.revision))
        )
          return Effect.fail(
            new GateRefusal('stale-instance', 'These settings changed since they were read.', [
              'read the instance again before saving its settings',
            ]),
          );
        return Effect.succeed({
          ...document,
          [instance.id]: { adapter, createdAt: standing?.createdAt ?? Date.now(), values: instance.values, secrets, revision },
        });
      }),
      { id: instance.id, values: instance.values, revision },
    );
  };
  const remove = (adapter: string, id: string) => {
    return file.update((document) => {
      if (document[id]?.adapter !== adapter) return Effect.succeed(document);
      const { [id]: _removed, ...remaining } = document;
      return Effect.succeed(remaining);
    });
  };
  return { read, moveSecrets, save, remove };
};
export type AdapterInstanceRows = ReturnType<typeof makeAdapterInstanceRows>;
