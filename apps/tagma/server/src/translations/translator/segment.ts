import { Data, Effect } from 'effect';
import { askOnce } from '../../graph/tree/oneShot.js';
import { partsOf, type Part, type Segmented } from './parts.js';

export class SegmentingFailed extends Data.TaggedError('SegmentingFailed')<{ readonly message: string }> {}

export type SegmentAnswer = { readonly state: 'parts'; readonly parts: readonly Part[] };

const ON_LOOP = 16_384;

const inWorker = (text: Segmented) =>
  askOnce<SegmentAnswer, SegmentingFailed>(
    new URL('./segment.worker.ts', import.meta.url),
    text,
    (message) => new SegmentingFailed({ message: `the segmenting worker failed: ${message}` }),
  ).pipe(Effect.map((answer) => answer.parts));

export const segment = Effect.fn('Translations.segment')(function* (text: Segmented) {
  yield* Effect.annotateCurrentSpan({ characters: text.body.length });
  return text.body.length <= ON_LOOP ? partsOf(text) : yield* inWorker(text);
});
