import { Schema } from 'effect';
import { basename, dirname, join } from 'node:path';
import { claudeUsage } from '../usage.js';
import {
  MetadataInvalid,
  emptyValues,
  fileSource,
  jsonValue,
  metadataDecode,
  metadataText,
  recordedValue,
  stampMillis,
  storageHome,
  transcriptSaid,
  unsaid,
  type MetadataField,
  type MetadataFold,
  type MetadataSession,
  type MetadataValues,
  type TailLocation,
  type TranscriptWords,
  type WordsSource,
} from '@runlith/tagma/adapter/metadata';

export const claudeTranscript = (input: MetadataSession): TailLocation | null => {
  if (input.transcriptPath !== undefined) return { root: dirname(input.transcriptPath), path: input.transcriptPath };
  const home = storageHome(input, 'CLAUDE_CONFIG_DIR', '.claude');
  if (home === null) return null;
  const root = join(home, 'projects');
  return { root, path: join(root, input.cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${input.rootKey}.jsonl`) };
};

const record = metadataDecode(
  Schema.Struct({
    type: Schema.String,
    sessionId: Schema.optional(Schema.String),
    isSidechain: Schema.optional(Schema.Boolean),
    effort: Schema.optional(metadataText),
    customTitle: Schema.optional(metadataText),
    aiTitle: Schema.optional(metadataText),
    message: Schema.optional(Schema.Unknown),
  }),
);
const assistant = metadataDecode(Schema.Struct({ model: Schema.optional(metadataText) }));

type ClaudeReading = MetadataValues & { readonly custom: string | null; readonly generated: string | null; readonly bound: boolean };

export const claude = (rootKey: string): MetadataFold<ClaudeReading> => ({
  empty: () => ({ ...emptyValues(), custom: null, generated: null, bound: false }),
  missed: claudeMissed,
  line: (read, text) => {
    const row = record(jsonValue(text));
    if (row.isSidechain === true) return read;
    if (row.sessionId !== undefined && row.sessionId !== rootKey) throw new MetadataInvalid({ reason: 'identity' });
    const standing = row.sessionId === rootKey && !read.bound ? { ...read, bound: true } : read;
    if (row.type === 'assistant') {
      if (row.sessionId !== rootKey) throw new MetadataInvalid({ reason: 'identity' });
      const model = assistant(row.message).model;
      const effort = row.effort === undefined ? standing.effort : recordedValue(row.effort);
      if (model === undefined || model === '<synthetic>') return { ...standing, effort };
      return { ...standing, model: recordedValue(model), effort };
    }
    if (row.type !== 'ai-title' && row.type !== 'custom-title') return standing;
    if (row.sessionId !== rootKey) throw new MetadataInvalid({ reason: 'identity' });
    const custom = row.type === 'custom-title' ? row.customTitle || null : standing.custom;
    const generated = row.type === 'ai-title' ? row.aiTitle || null : standing.generated;
    return { ...standing, custom, generated, title: recordedValue(custom ?? generated) };
  },
});

const thirdKey = /^\{"parentUuid":[^,}]{0,80},"isSidechain":(?:true|false),"([A-Za-z]+)"\s*:/;
const sidechainHead = /^\{"parentUuid":[^,}]{0,80},"isSidechain":true,/;
const leadingType = /^\{"type":"([a-z-]+)"/;
const thirdType = /^\{"parentUuid":[^,}]{0,80},"isSidechain":(?:true|false),"type":"([a-z-]+)"/;
const claudeIgnored = new Set([
  'user',
  'system',
  'attachment',
  'file-history-snapshot',
  'file-history-delta',
  'last-prompt',
  'mode',
  'permission-mode',
  'atis-latch',
  'bridge-session',
  'queue-operation',
  'agent-name',
  'cost-state',
  'frame-link',
]);

const claudeMissed = (head: string): readonly MetadataField[] => {
  if (sidechainHead.test(head)) return [];
  const tag = (name: string | undefined): readonly MetadataField[] =>
    name === 'assistant'
      ? ['model', 'effort']
      : name === 'ai-title' || name === 'custom-title'
        ? ['title']
        : name !== undefined && claudeIgnored.has(name)
          ? []
          : ['model', 'effort', 'title'];
  const third = thirdKey.exec(head)?.[1];
  if (third !== undefined) {
    if (third === 'attachment' || third === 'promptId') return [];
    if (third === 'message') return ['model', 'effort'];
    if (third === 'type') return tag(thirdType.exec(head)?.[1]);
    return ['model', 'effort', 'title'];
  }
  const leading = leadingType.exec(head)?.[1];
  return leading === undefined ? ['model', 'effort', 'title'] : tag(leading);
};

export const claudeSources = (input: MetadataSession) => {
  const where = claudeTranscript(input);
  const transcript =
    where !== null && basename(where.path) !== `${input.rootKey}.jsonl`
      ? {
          kind: 'unreadable' as const,
          reason: 'session-identity-mismatch',
          source: 'transcript' as const,
          fields: ['model', 'effort', 'title'] as const,
        }
      : fileSource(where?.root ?? null, where?.path, claude(input.rootKey), ['model', 'effort', 'title']);
  return [transcript];
};

const wordsEntry = metadataDecode(
  Schema.Struct({
    type: Schema.String,
    subtype: Schema.optional(Schema.String),
    sessionId: Schema.optional(Schema.String),
    isSidechain: Schema.optional(Schema.Boolean),
    timestamp: Schema.optional(Schema.String),
    message: Schema.optional(Schema.Unknown),
    compactMetadata: Schema.optional(Schema.Unknown),
  }),
);
const wordsMessage = metadataDecode(Schema.Struct({ content: Schema.Unknown }));
const compactedTokens = Schema.decodeUnknownResult(Schema.Struct({ postTokens: Schema.Number }));
const wordsCall = metadataDecode(
  Schema.Struct({ id: Schema.optional(Schema.String), model: Schema.optional(Schema.String), usage: Schema.optional(Schema.Unknown) }),
);

const SYNTHETIC = '<synthetic>';

const claudeWords = (rootKey: string): MetadataFold<TranscriptWords> => ({
  empty: unsaid,
  line: (standing, text) => {
    const row = wordsEntry(jsonValue(text));
    if (row.isSidechain !== true && row.sessionId !== undefined && row.sessionId !== rootKey)
      throw new MetadataInvalid({ reason: 'identity' });
    if (row.type === 'assistant') {
      if (row.message === undefined) return standing;
      const call = wordsCall(row.message);
      const usage = claudeUsage(call.usage);
      const id = call.id ?? text;
      if (usage !== undefined && call.model !== SYNTHETIC)
        standing.requests.set(id, {
          id,
          usage,
          model: call.model ?? null,
          at: standing.requests.get(id)?.at ?? stampMillis(row.timestamp),
          main: row.isSidechain !== true,
        });
      return standing;
    }
    if (row.type === 'system' && row.subtype === 'compact_boundary' && row.isSidechain !== true) {
      const read = compactedTokens(row.compactMetadata);
      return {
        ...standing,
        compacted: { tokens: read._tag === 'Success' ? read.success.postTokens : null, at: stampMillis(row.timestamp) },
      };
    }
    if (row.isSidechain === true || row.type !== 'user') return standing;
    const said = transcriptSaid(wordsMessage(row.message).content, row.timestamp);
    return said === null ? standing : { ...standing, said: [...standing.said, said] };
  },
});

export const claudeWordSources = (input: MetadataSession): readonly WordsSource[] => {
  const where = claudeTranscript(input);
  return [{ root: where?.root ?? null, path: where?.path, fold: claudeWords(input.rootKey) }];
};
