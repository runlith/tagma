import { Schema } from 'effect';
import { join } from 'node:path';
import {
  MetadataInvalid,
  emptyValues,
  fileSource,
  jsonValue,
  metadataDecode,
  metadataText,
  recordedValue,
  storageHome,
  type MetadataLocation,
  type MetadataSession,
  type MetadataValues,
} from '@runlith/tagma/adapter/metadata';

const summary = metadataDecode(
  Schema.Struct({
    info: Schema.Struct({ id: Schema.String }),
    current_model_id: Schema.optional(metadataText),
    generated_title: Schema.optional(Schema.NullOr(metadataText)),
    session_summary: Schema.optional(Schema.NullOr(metadataText)),
  }),
);

export function grok(rootKey: string, text: string): MetadataValues {
  const row = summary(jsonValue(text));
  if (row.info.id !== rootKey) throw new MetadataInvalid({ reason: 'identity' });
  return { ...emptyValues(), model: recordedValue(row.current_model_id), title: recordedValue(row.generated_title || row.session_summary) };
}

export const grokSources = (input: MetadataSession): readonly MetadataLocation[] => {
  const home = storageHome(input, 'GROK_HOME', '.grok');
  const root = home === null ? null : join(home, 'sessions', encodeURIComponent(input.cwd));
  return [
    fileSource(
      root,
      root === null ? undefined : join(root, input.rootKey, 'summary.json'),
      {
        json: true,
        empty: emptyValues,
        line: (_, text) => grok(input.rootKey, text),
      },
      ['model', 'title'],
      'session-store',
      true,
    ),
    { kind: 'unsupported', source: 'session-store', fields: ['effort'] },
  ];
};
