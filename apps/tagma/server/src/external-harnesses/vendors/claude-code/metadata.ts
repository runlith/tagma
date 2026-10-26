import { Schema } from 'effect';
import { basename, dirname, join } from 'node:path';
import { fileSource, storageHome, type MetadataAdapter, type MetadataInput } from '../../metadata/sources.js';
import type { TailLocation } from '../../ends/tail.js';

export const claudeTranscript = (input: MetadataInput): TailLocation | null => {
  if (input.transcriptPath !== undefined) return { root: dirname(input.transcriptPath), path: input.transcriptPath };
  const home = storageHome(input, 'CLAUDE_CONFIG_DIR', '.claude');
  if (home === null) return null;
  const root = join(home, 'projects');
  return { root, path: join(root, input.cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${input.rootKey}.jsonl`) };
};

export const claudeSources: MetadataAdapter = (input) => {
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
import { MetadataInvalid, type MetadataFold } from '../../metadata/file.js';
import { emptyValues, jsonValue, metadataDecode, metadataText, recordedValue, type MetadataValues } from '../../metadata/fields.js';
import type { HarnessFields } from '../../../threads/contract/wire/harness/observation.js';

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

const claudeMissed = (head: string): readonly (keyof HarnessFields)[] => {
  if (sidechainHead.test(head)) return [];
  const tag = (name: string | undefined): readonly (keyof HarnessFields)[] =>
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
