import { Schema } from 'effect';
import { basename, dirname, join } from 'node:path';
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
  type MetadataField,
  type MetadataFold,
  type MetadataLocation,
  type MetadataSession,
  type MetadataValues,
  type TranscriptWords,
  type WordsSource,
} from '@runlith/tagma/adapter/metadata';

const envelope = metadataDecode(Schema.Struct({ type: Schema.String, payload: Schema.Unknown }));
const session = metadataDecode(Schema.Struct({ id: Schema.String, session_id: Schema.optional(Schema.String) }));
const context = metadataDecode(
  Schema.Struct({
    model: metadataText,
    effort: Schema.optional(Schema.NullOr(metadataText)),
    turn_id: Schema.optional(Schema.String),
  }),
);
const title = metadataDecode(Schema.Struct({ id: Schema.String, thread_name: metadataText }));

export function codexIndex(text: string): { id: string; title: string | null } {
  const row = title(jsonValue(text));
  return { id: row.id, title: row.thread_name || null };
}

export const codexRolloutName = (file: string, rootKey: string): boolean => {
  if (!file.endsWith('.jsonl')) return false;
  const stem = file.slice(0, -'.jsonl'.length);
  return stem.endsWith(`-${rootKey}`) || stem.includes(`-${rootKey}_`);
};

type CodexReading = MetadataValues & { readonly bound: boolean };

export const codex = (rootKey: string): MetadataFold<CodexReading> => ({
  empty: () => ({ ...emptyValues(), bound: false }),
  missed: codexMissed,
  line: (standing, text) => {
    const row = envelope(jsonValue(text));
    if (row.type === 'session_meta') {
      const named = session(row.payload);
      if (named.id !== rootKey || (named.session_id !== undefined && named.session_id !== rootKey)) {
        throw new MetadataInvalid({ reason: 'identity' });
      }
      return { ...standing, bound: true };
    }
    if (row.type !== 'turn_context') return standing;
    if (!standing.bound) throw new MetadataInvalid({ reason: 'identity' });
    const turn = context(row.payload);
    return {
      ...standing,
      model: recordedValue(turn.model, turn.turn_id ?? null),
      effort: recordedValue(turn.effort, turn.turn_id ?? null),
    };
  },
});

const envelopeType = /^\{"timestamp":"[^"]{0,60}","ordinal":[0-9]+,"type":"([A-Za-z_]+)"/;
const codexIgnored = new Set(['response_item', 'event_msg', 'compacted', 'world_state']);

const codexMissed = (head: string): readonly MetadataField[] => {
  const tag = envelopeType.exec(head)?.[1];
  return tag === 'turn_context' || tag === 'session_meta'
    ? ['model', 'effort']
    : tag !== undefined && codexIgnored.has(tag)
      ? []
      : ['model', 'effort'];
};

export const codexSources = (input: MetadataSession): readonly MetadataLocation[] => {
  const home = storageHome(input, 'CODEX_HOME', '.codex');
  const archive = home === null ? null : join(home, 'archived_sessions');
  const root =
    home === null ? null : archive !== null && input.transcriptPath?.startsWith(`${archive}/`) ? archive : join(home, 'sessions');
  return [
    home === null
      ? { kind: 'unreadable', source: 'session-store', fields: ['title'], reason: 'source-location-unavailable' }
      : {
          kind: 'index',
          source: 'session-store',
          fields: ['title'],
          root: home,
          path: join(home, 'session_index.jsonl'),
          parse: codexIndex,
        },
    input.transcriptPath !== undefined && !codexRolloutName(basename(input.transcriptPath), input.rootKey)
      ? { kind: 'unreadable', reason: 'session-identity-mismatch', source: 'transcript', fields: ['model', 'effort'] }
      : fileSource(root, input.transcriptPath, codex(input.rootKey), ['model', 'effort']),
  ];
};

const wordsEnvelope = metadataDecode(
  Schema.Struct({ type: Schema.String, timestamp: Schema.optional(Schema.String), payload: Schema.Unknown }),
);
const wordsItem = metadataDecode(
  Schema.Struct({
    type: Schema.String,
    role: Schema.optional(Schema.String),
    content: Schema.Unknown,
  }),
);
const wordsMeta = metadataDecode(Schema.Struct({ id: Schema.String }));

const codexWords = (rootKey: string): MetadataFold<TranscriptWords> => ({
  empty: unsaid,
  line: (standing, text) => {
    const row = wordsEnvelope(jsonValue(text));
    if (row.type === 'session_meta') {
      if (wordsMeta(row.payload).id !== rootKey) throw new MetadataInvalid({ reason: 'identity' });
      return standing;
    }
    if (row.type !== 'response_item') return standing;
    const item = wordsItem(row.payload);
    if (item.type !== 'message' || item.role !== 'user') return standing;
    const said = transcriptSaid(item.content, row.timestamp);
    return said === null ? standing : { ...standing, said: [...standing.said, said] };
  },
});

export const codexWordSources = (input: MetadataSession): readonly WordsSource[] => [
  {
    root: input.transcriptPath === undefined ? null : dirname(input.transcriptPath),
    path: input.transcriptPath,
    fold: codexWords(input.rootKey),
  },
];
