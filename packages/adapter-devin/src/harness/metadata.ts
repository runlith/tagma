import { Schema } from 'effect';
import { dirname, join } from 'node:path';
import {
  MetadataInvalid,
  emptyValues,
  fileSource,
  jsonValue,
  metadataDecode,
  metadataText,
  recordedValue,
  storageHome,
  transcriptSaid,
  unsaid,
  type MetadataFold,
  type MetadataLocation,
  type MetadataSession,
  type MetadataValue,
  type MetadataValues,
  type TranscriptWords,
  type WordsSource,
} from '@runlith/tagma/adapter/metadata';

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

export const devinSources = (input: MetadataSession): readonly MetadataLocation[] => [
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

const atifDoc = metadataDecode(
  Schema.Struct({
    schema_version: Schema.String,
    session_id: Schema.String,
    steps: Schema.Array(Schema.Struct({ source: Schema.String, message: Schema.Unknown, timestamp: Schema.optional(Schema.String) })),
  }),
);

const atifWords = (rootKey: string): MetadataFold<TranscriptWords> => ({
  json: true,
  empty: unsaid,
  line: (_standing, text) => {
    const doc = atifDoc(jsonValue(text));
    if (doc.session_id !== rootKey) throw new MetadataInvalid({ reason: 'identity' });
    return {
      ...unsaid(),
      said: doc.steps.flatMap((step) => {
        const said = step.source === 'user' ? transcriptSaid(step.message, step.timestamp) : null;
        return said === null ? [] : [said];
      }),
    };
  },
});

export const devinWordSources = (input: MetadataSession): readonly WordsSource[] => {
  const data = storageHome(input, 'XDG_DATA_HOME', '.local/share');
  const live = data === null ? undefined : join(data, 'devin', 'cli', 'transcripts', `${input.rootKey}.json`);
  return [live, input.exportPath]
    .filter((path): path is string => path !== undefined)
    .map((path) => ({ root: dirname(path), path, fold: atifWords(input.rootKey) }));
};
