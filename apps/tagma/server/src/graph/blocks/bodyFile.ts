import { Effect } from 'effect';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { BatchSourceUnreadable, BatchFiles } from '../work/batchFiles.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';

const BODY_CODES = new Set(['body-capped', 'body-address']);

export function aboutBody(code: string): boolean {
  return BODY_CODES.has(code);
}

export const withBodyFile = Effect.fn('Blocks.withBodyFile')(function* <A, Code extends string, R>(
  input: { readonly base?: string | undefined; readonly body?: string | undefined; readonly bodyFile?: string | undefined },
  write: (body: string | undefined) => Effect.Effect<A, StoreFailure | GateRefusal<Code>, R>,
): Effect.fn.Return<A, StoreFailure | GateRefusal<Code | 'body-source'>, R | BatchFiles> {
  const named = input.bodyFile;
  if (named === undefined) return yield* write(input.body);
  if (input.body !== undefined) {
    return yield* new GateRefusal('body-source', 'a body arrives one way: as text, or as the file holding it', [
      'pass the text, or the path of the file that holds it — never both',
    ]);
  }
  const sources = yield* BatchFiles;
  const read = yield* sources
    .body(input.base, named)
    .pipe(
      Effect.catchTag(
        'BatchSourceUnreadable',
        (error: BatchSourceUnreadable) =>
          new GateRefusal(
            'body-source',
            `body file ${error.message}`,
            [
              'write the body into that file first, then hand the same path',
              'a relative path is measured from where the caller stands; an absolute one is taken as written',
            ],
            error.path,
          ),
      ),
    );
  return yield* write(read.text).pipe(
    Effect.catchTag('GateRefusal', (refusal: GateRefusal<Code>) => {
      const aboutTheBody = aboutBody(refusal.code);
      return new GateRefusal(
        refusal.code,
        refusal.reason,
        aboutTheBody
          ? [`edit ${read.path} and hand the same path again: it is read fresh on every call`, ...refusal.unblock]
          : [...refusal.unblock, `the body stands in ${read.path}, read fresh on every call`],
        read.path,
      );
    }),
  );
});
