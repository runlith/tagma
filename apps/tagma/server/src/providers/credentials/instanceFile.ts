import { join } from 'node:path';
import { makeCredentialFile } from '@runlith/credential-file/CredentialFile';
import { CredentialFileInvalid } from '@runlith/credential-file/failure';
import type { SettingInstance, SettingRow } from '@runlith/tagma/adapter/provider';
import type { InstanceSnapshot } from '../contract/service/instances.js';
import { Effect, Schema } from 'effect';

export type InstanceRecord = {
  readonly adapter: string;
  readonly createdAt: number;
  readonly revision: string;
  readonly values: SettingRow;
  readonly secrets: SettingRow;
};
export type InstanceDocument = Readonly<Record<string, InstanceRecord>>;

export const instanceSnapshot = (document: InstanceDocument): InstanceSnapshot => {
  const instances = new Map<string, SettingInstance[]>();
  const secrets: Record<string, SettingRow> = {};
  const rows = Object.entries(document).sort(([idA, a], [idB, b]) => a.createdAt - b.createdAt || idA.localeCompare(idB));
  for (const [id, row] of rows) {
    const list = instances.get(row.adapter) ?? [];
    list.push({ id, values: row.values, revision: row.revision });
    instances.set(row.adapter, list);
    secrets[id] = row.secrets;
  }
  return { instances, secrets };
};

const values = Schema.Record(Schema.String, Schema.Unknown);
const document = Schema.Record(
  Schema.String,
  Schema.Struct({ adapter: Schema.String, createdAt: Schema.Number, revision: Schema.String, values, secrets: values }),
);

export const instanceFile = (directory: string) =>
  makeCredentialFile<InstanceDocument>({
    path: join(directory, 'adapter-settings.json'),
    codec: {
      empty: () => ({}),
      decode: (path, parsed) =>
        Schema.decodeUnknownEffect(document)(parsed).pipe(
          Effect.map((value) => ({ value: value as InstanceDocument, needsWrite: false })),
          Effect.mapError((cause) => new CredentialFileInvalid({ path, reason: cause.message })),
        ),
    },
  });
