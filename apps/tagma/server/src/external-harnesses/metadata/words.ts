import { Context, Effect, FileSystem, Layer } from 'effect';
import type { TranscriptCompaction, TranscriptRequest, TranscriptWords, WordsSource } from '@runlith/tagma/adapter/metadata';
import type { Environments } from '../../workspace/contract/service/environments.js';
import type { EnvironmentVerdictFailure } from '../../workspace/contract/wire/environments.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { HarnessAdapter } from '../contract/service/adapter.js';
import { inputEnvelopes, promptDigest } from '../adapter/input.js';
import { MetadataFile } from './file.js';
import { DOCUMENT_LIMITS, METADATA_PAGES, TRANSCRIPT_LIMITS } from './policy.js';
import type { MetadataInput } from './input.js';

export type HeardPrompt = { readonly digest: string; readonly at: number | null };

export type HarnessWords = {
  readonly words: string[];
  readonly inputs: string[];
  readonly prompts: HeardPrompt[];
  readonly requests: Map<string, TranscriptRequest>;
  readonly compacted: TranscriptCompaction | null;
};

export type HarnessReading = HarnessWords & { readonly complete: boolean; readonly skipped: number };

const releaseMissed = (failure: EnvironmentVerdictFailure) =>
  Effect.logWarning('harness words environment use could not be released', { reason: failure._tag });

const unheard = (): HarnessWords => ({ words: [], inputs: [], prompts: [], requests: new Map(), compacted: null });

export const heardWords = (value: TranscriptWords): HarnessWords => ({
  words: value.said.flatMap((said) => said.typed),
  inputs: value.said.flatMap((said) => said.texts.flatMap(inputEnvelopes)),
  prompts: value.said.map((said) => ({ digest: promptDigest(said.texts.join('\n')), at: said.at })),
  requests: value.requests,
  compacted: value.compacted,
});

export const transcriptUsage = (adapter: HarnessAdapter): boolean => adapter.metadata?.words?.usage === true;

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
  const declared = adapter.metadata?.words?.sources;
  const sources =
    declared === undefined
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
        const heard = heardWords(page.value);
        if (heard.words.length > 0 || heard.inputs.length > 0) return { ...heard, complete: page.complete, skipped: page.skipped };
        if (heard.prompts.length > 0 || heard.requests.size > 0 || heard.compacted !== null)
          prompted ??= { ...heard, complete: page.complete, skipped: page.skipped };
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
