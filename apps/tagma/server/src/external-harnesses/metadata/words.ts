import { Context, Effect, FileSystem, Layer, Schema, type Scope } from 'effect';
import { dirname, join } from 'node:path';
import type { Environments } from '../../workspace/contract/service/environments.js';
import type { EnvironmentVerdictFailure } from '../../workspace/contract/wire/environments.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { HarnessAdapter } from '../contract/service/adapter.js';
import { jsonValue, metadataDecode } from './fields.js';
import { inputEnvelopes, promptDigest } from '../adapter/input.js';
import { claudeTranscript } from '../vendors/claude-code/metadata.js';
import { claudeUsage } from '@runlith/adapter-anthropic/usage';
import type { Usage } from '@runlith/llm/schema/events';
import { MetadataFile, MetadataInvalid, type MetadataFold } from './file.js';
import { DOCUMENT_LIMITS, METADATA_PAGES, TRANSCRIPT_LIMITS } from './policy.js';
import { storageHome, type MetadataInput } from './sources.js';

export type HeardPrompt = { readonly digest: string; readonly at: number | null };

export type HarnessRequest = {
  readonly id: string;
  readonly usage: Usage;
  readonly model: string | null;
  readonly at: number | null;
  readonly main: boolean;
};

export type HarnessCompaction = { readonly tokens: number | null; readonly at: number | null };

export type HarnessWords = {
  readonly words: string[];
  readonly inputs: string[];
  readonly prompts: HeardPrompt[];
  readonly requests: Map<string, HarnessRequest>;
  readonly compacted: HarnessCompaction | null;
};

export type HarnessReading = HarnessWords & { readonly complete: boolean; readonly skipped: number };

const releaseMissed = (failure: EnvironmentVerdictFailure) =>
  Effect.logWarning('harness words environment use could not be released', { reason: failure._tag });

export type WordsSource = {
  readonly root: string | null;
  readonly path: string | undefined;
  readonly fold: MetadataFold<HarnessWords>;
};

export type WordsAdapter = (input: MetadataInput) => readonly WordsSource[];

function userText(message: unknown): readonly string[] {
  if (typeof message === 'string') return [message];
  if (!Array.isArray(message)) return [];
  return message.flatMap((part) => {
    if (typeof part !== 'object' || part === null) return [];
    const entry = part as Record<string, unknown>;
    return (entry.type === 'text' || entry.type === 'input_text') && typeof entry.text === 'string' ? [entry.text] : [];
  });
}

function readerParts(message: unknown): readonly string[] {
  return userText(message).filter((part) => {
    const text = part.trim();
    return text !== '' && !text.startsWith('<') && !text.startsWith('# AGENTS.md');
  });
}

const stampOf = (value: string | undefined): number | null => {
  const at = value === undefined ? Number.NaN : Date.parse(value);
  return Number.isNaN(at) ? null : at;
};

const heard = (standing: HarnessWords, message: unknown, stamp: string | undefined): HarnessWords => {
  const texts = userText(message);
  const said = texts.join('\n');
  const words = readerParts(message);
  const inputs = texts.flatMap(inputEnvelopes);
  if (said.trim() === '') return standing;
  return {
    words: [...standing.words, ...words],
    inputs: [...standing.inputs, ...inputs],
    prompts: [...standing.prompts, { digest: promptDigest(said), at: stampOf(stamp) }],
    requests: standing.requests,
    compacted: standing.compacted,
  };
};

const unheard = (): HarnessWords => ({ words: [], inputs: [], prompts: [], requests: new Map(), compacted: null });

const atifDoc = metadataDecode(
  Schema.Struct({
    schema_version: Schema.String,
    session_id: Schema.String,
    steps: Schema.Array(Schema.Struct({ source: Schema.String, message: Schema.Unknown, timestamp: Schema.optional(Schema.String) })),
  }),
);

const atifWords = (rootKey: string): MetadataFold<HarnessWords> => ({
  json: true,
  empty: unheard,
  line: (_standing, text) => {
    const doc = atifDoc(jsonValue(text));
    if (doc.session_id !== rootKey) throw new MetadataInvalid({ reason: 'identity' });
    return doc.steps.reduce(
      (standing, step) => (step.source === 'user' ? heard(standing, step.message, step.timestamp) : standing),
      unheard(),
    );
  },
});

const devinWords: WordsAdapter = (input) => {
  const data = storageHome(input, 'XDG_DATA_HOME', '.local/share');
  const live = data === null ? undefined : join(data, 'devin', 'cli', 'transcripts', `${input.rootKey}.json`);
  return [live, input.exportPath]
    .filter((path): path is string => path !== undefined)
    .map((path) => ({ root: dirname(path), path, fold: atifWords(input.rootKey) }));
};

const claudeEntry = metadataDecode(
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
const claudeMessage = metadataDecode(Schema.Struct({ content: Schema.Unknown }));
const claudeCompacted = Schema.decodeUnknownResult(Schema.Struct({ postTokens: Schema.Number }));
const claudeCall = metadataDecode(
  Schema.Struct({ id: Schema.optional(Schema.String), model: Schema.optional(Schema.String), usage: Schema.optional(Schema.Unknown) }),
);

const SYNTHETIC = '<synthetic>';

const claudeWords = (rootKey: string): MetadataFold<HarnessWords> => ({
  empty: unheard,
  line: (standing, text) => {
    const row = claudeEntry(jsonValue(text));
    if (row.isSidechain !== true && row.sessionId !== undefined && row.sessionId !== rootKey)
      throw new MetadataInvalid({ reason: 'identity' });
    if (row.type === 'assistant') {
      if (row.message === undefined) return standing;
      const call = claudeCall(row.message);
      const usage = claudeUsage(call.usage);
      const id = call.id ?? text;
      if (usage !== undefined && call.model !== SYNTHETIC)
        standing.requests.set(id, {
          id,
          usage,
          model: call.model ?? null,
          at: standing.requests.get(id)?.at ?? stampOf(row.timestamp),
          main: row.isSidechain !== true,
        });
      return standing;
    }
    if (row.type === 'system' && row.subtype === 'compact_boundary' && row.isSidechain !== true) {
      const read = claudeCompacted(row.compactMetadata);
      return { ...standing, compacted: { tokens: read._tag === 'Success' ? read.success.postTokens : null, at: stampOf(row.timestamp) } };
    }
    if (row.isSidechain === true || row.type !== 'user') return standing;
    return heard(standing, claudeMessage(row.message).content, row.timestamp);
  },
});

const claudePath: WordsAdapter = (input) => {
  const where = claudeTranscript(input);
  return [{ root: where?.root ?? null, path: where?.path, fold: claudeWords(input.rootKey) }];
};

const codexEnvelope = metadataDecode(
  Schema.Struct({ type: Schema.String, timestamp: Schema.optional(Schema.String), payload: Schema.Unknown }),
);
const codexItem = metadataDecode(
  Schema.Struct({
    type: Schema.String,
    role: Schema.optional(Schema.String),
    content: Schema.Unknown,
  }),
);
const codexMeta = metadataDecode(Schema.Struct({ id: Schema.String }));

const codexWords = (rootKey: string): MetadataFold<HarnessWords> => ({
  empty: unheard,
  line: (standing, text) => {
    const row = codexEnvelope(jsonValue(text));
    if (row.type === 'session_meta') {
      if (codexMeta(row.payload).id !== rootKey) throw new MetadataInvalid({ reason: 'identity' });
      return standing;
    }
    if (row.type !== 'response_item') return standing;
    const item = codexItem(row.payload);
    if (item.type !== 'message' || item.role !== 'user') return standing;
    return heard(standing, item.content, row.timestamp);
  },
});

const codexPath: WordsAdapter = (input) => [
  {
    root: input.transcriptPath === undefined ? null : dirname(input.transcriptPath),
    path: input.transcriptPath,
    fold: codexWords(input.rootKey),
  },
];

const words: Partial<Record<NonNullable<HarnessAdapter['metadata']>, { readonly source: WordsAdapter; readonly usage: boolean }>> = {
  'devin-atif': { source: devinWords, usage: false },
  'claude-jsonl': { source: claudePath, usage: true },
  'codex-rollout': { source: codexPath, usage: false },
};

export function wordsAdapter(adapter: HarnessAdapter): WordsAdapter | null {
  return adapter.metadata === undefined ? null : (words[adapter.metadata]?.source ?? null);
}

export const transcriptUsage = (adapter: HarnessAdapter): boolean =>
  adapter.metadata !== undefined && words[adapter.metadata]?.usage === true;

export const sessionFiles = Effect.fnUntraced(function* (
  access: Environments['Service'],
  input: MetadataInput,
  consumer: { readonly kind: string; readonly id: string },
) {
  const acquired = yield* access.acquireActive({
    binding: input.storage.binding,
    consumer,
    requires: ['files'],
  });
  yield* Effect.addFinalizer(() =>
    acquired.use._tag === 'Retained'
      ? access.releaseUse(acquired.use.use.useId, consumer, 'cleanup-confirmed').pipe(
          Effect.catchTags({
            EnvironmentUnavailable: releaseMissed,
            EnvironmentReplaced: releaseMissed,
            EnvironmentAccessDenied: releaseMissed,
            EnvironmentUseConflict: releaseMissed,
            ActivationUnsupported: releaseMissed,
            EnvironmentRegistryUnavailable: releaseMissed,
            EnvironmentUseMissing: releaseMissed,
            EnvironmentUseResolved: releaseMissed,
          }),
          Effect.asVoid,
        )
      : Effect.void,
  );
  if (acquired.world.files === undefined)
    return yield* new GateRefusal('metadata-unreadable', 'The session environment has no readable files.', [
      'restore access to the session environment and retry',
    ]);
  const files = Context.get(yield* Layer.build(acquired.world.files), FileSystem.FileSystem);
  return files;
});

export function readHarnessTranscript(
  access: Environments['Service'],
  input: MetadataInput,
  adapter: HarnessAdapter,
  from: number = 0,
): Effect.Effect<HarnessReading, GateRefusal> {
  const declared = wordsAdapter(adapter);
  const sources =
    declared === null
      ? []
      : declared(input).filter(
          (source): source is WordsSource & { root: string; path: string } => source.root !== null && source.path !== undefined,
        );
  if (sources.length === 0) return Effect.succeed({ ...unheard(), complete: true, skipped: 0 });
  const consumer = { kind: 'harness-words', id: input.execution.execution };
  return Effect.scoped(
    Effect.gen(function* () {
      const files = yield* sessionFiles(access, input, consumer);
      let unreadable: string | null = null;
      let partial = false;
      let dropped = 0;
      let prompted: HarnessReading | null = null;
      for (const source of sources) {
        const json = source.fold.json === true;
        const cursor = new MetadataFile(source.fold, json ? DOCUMENT_LIMITS : TRANSCRIPT_LIMITS, from);
        const pages = json ? Math.ceil(DOCUMENT_LIMITS.recordBytes / DOCUMENT_LIMITS.bytes) + 1 : METADATA_PAGES;
        let page = yield* cursor.read(files, source.root, source.path);
        for (let at = 1; page._tag === 'Read' && !page.complete && at < pages; at += 1) {
          page = yield* cursor.read(files, source.root, source.path);
        }
        if (page._tag === 'Unreadable') unreadable ??= page.reason;
        if (page._tag === 'Read' && !page.complete) partial = true;
        if (page._tag !== 'Read') continue;
        dropped += page.skipped;
        if (page.value.words.length > 0 || page.value.inputs.length > 0)
          return { ...page.value, complete: page.complete, skipped: page.skipped };
        if (page.value.prompts.length > 0 || page.value.requests.size > 0 || page.value.compacted !== null)
          prompted ??= { ...page.value, complete: page.complete, skipped: page.skipped };
      }
      if (unreadable !== null)
        return yield* new GateRefusal('metadata-unreadable', `The session transcript is unreadable (${unreadable}).`, [
          'repair the transcript or retry with an accessible session',
        ]);
      return prompted ?? { ...unheard(), complete: !partial, skipped: dropped };
    }).pipe(
      Effect.mapError((failure) =>
        failure instanceof GateRefusal
          ? failure
          : new GateRefusal('metadata-unreadable', 'The session transcript could not be read.', [
              'restore access to the session environment and retry',
            ]),
      ),
      Effect.withSpan('HarnessWords.read'),
    ),
  );
}
