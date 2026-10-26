import { Schema } from 'effect';
import { basename, join } from 'node:path';
import { fileSource, storageHome, type MetadataAdapter } from '../../metadata/sources.js';

export const codexSources: MetadataAdapter = (input) => {
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
import { MetadataInvalid, type MetadataFold } from '../../metadata/file.js';
import { emptyValues, jsonValue, metadataDecode, metadataText, recordedValue, type MetadataValues } from '../../metadata/fields.js';
import type { HarnessFields } from '../../../threads/contract/wire/harness/observation.js';

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

const codexMissed = (head: string): readonly (keyof HarnessFields)[] => {
  const tag = envelopeType.exec(head)?.[1];
  return tag === 'turn_context' || tag === 'session_meta'
    ? ['model', 'effort']
    : tag !== undefined && codexIgnored.has(tag)
      ? []
      : ['model', 'effort'];
};
