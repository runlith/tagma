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
  type MetadataReader,
  type MetadataSession,
  type MetadataValues,
} from '@runlith/tagma/adapter/metadata';
import { grokEnds } from './ends';

const summary = metadataDecode(
  Schema.Struct({
    info: Schema.Struct({ id: Schema.String }),
    current_model_id: Schema.optional(metadataText),
    generated_title: Schema.optional(Schema.NullOr(metadataText)),
    session_summary: Schema.optional(Schema.NullOr(metadataText)),
  }),
);

const summaryValues = (rootKey: string, text: string): MetadataValues => {
  const row = summary(jsonValue(text));
  if (row.info.id !== rootKey) throw new MetadataInvalid({ reason: 'identity' });
  return { ...emptyValues(), model: recordedValue(row.current_model_id), title: recordedValue(row.generated_title || row.session_summary) };
};

const grokSources = (input: MetadataSession): readonly MetadataLocation[] => {
  const home = storageHome(input, 'GROK_HOME', '.grok');
  const root = home === null ? null : join(home, 'sessions', encodeURIComponent(input.cwd));
  return [
    fileSource(
      root,
      root === null ? undefined : join(root, input.rootKey, 'summary.json'),
      {
        json: true,
        empty: emptyValues,
        line: (_, text) => summaryValues(input.rootKey, text),
      },
      ['model', 'title'],
      'session-store',
      true,
    ),
    { kind: 'unsupported', source: 'session-store', fields: ['effort'] },
  ];
};

export const grokReader: MetadataReader = {
  sources: grokSources,
  provenance: {
    model: { source: 'session-store', readable: true },
    effort: { source: 'session-store', readable: false },
    title: { source: 'session-store', readable: true },
  },
  ends: grokEnds,
};
