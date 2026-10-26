import { join } from 'node:path';
import { makeCredentialFile } from '@runlith/credential-file/CredentialFile';
import { CredentialFileInvalid } from '@runlith/credential-file/failure';
import type { SettingRow } from '@runlith/tagma/adapter/provider';
import { Effect, Schema } from 'effect';

export type InstanceRecord = {
  readonly adapter: string;
  readonly createdAt: number;
  readonly revision: string;
  readonly values: SettingRow;
  readonly secrets: SettingRow;
};
export type InstanceDocument = Readonly<Record<string, InstanceRecord>>;

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
