import { Schema } from 'effect';
import { dirname } from 'node:path';
import { fileSource, type MetadataAdapter } from '../../metadata/sources.js';

export const devinSources: MetadataAdapter = (input) => [
  fileSource(
    input.exportPath === undefined ? null : dirname(input.exportPath),
    input.exportPath,
    {
      json: true,
      empty: emptyValues,
      line: (_, text) => devin(input.rootKey, text),
    },
    ['model'],
  ),
  {
    kind: 'command',
    program: 'devin',
    args: ['list', '--format', 'json'],
    parse: (text) => devinTitle(input.rootKey, text),
    source: 'session-store',
    fields: ['title'],
  },
  { kind: 'unsupported', source: 'transcript', fields: ['effort'] },
];
import { MetadataInvalid } from '../../metadata/file.js';
import {
  emptyValues,
  jsonValue,
  metadataDecode,
  metadataText,
  recordedValue,
  type MetadataValue,
  type MetadataValues,
} from '../../metadata/fields.js';

const exported = metadataDecode(
  Schema.Struct({
    schema_version: Schema.String,
    session_id: Schema.String,
    agent: Schema.Struct({ model_name: Schema.optional(metadataText) }),
  }),
);
const listed = metadataDecode(
  Schema.Array(
    Schema.Struct({
      id: Schema.String,
      short_id: Schema.optional(Schema.String),
      title: Schema.optional(Schema.NullOr(metadataText)),
    }),
  ),
);

export function devin(rootKey: string, text: string): MetadataValues {
  const row = exported(jsonValue(text));
  if (row.session_id !== rootKey) throw new MetadataInvalid({ reason: 'identity' });
  if (!row.schema_version.startsWith('ATIF-v')) throw new MetadataInvalid({ reason: 'malformed' });
  return { ...emptyValues(), model: recordedValue(row.agent.model_name) };
}

export function devinTitle(rootKey: string, text: string): MetadataValue | null {
  const rows = listed(jsonValue(text));
  const matches = rows.filter((row) => row.id === rootKey || row.short_id === rootKey);
  if (matches.length > 1) throw new MetadataInvalid({ reason: 'identity' });
  return recordedValue(matches[0]?.title);
}
