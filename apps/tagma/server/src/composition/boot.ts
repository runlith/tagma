import { Effect } from 'effect';
import type { HarnessFailure } from '../threads/contract/service/failure.js';
import { BlockProjection } from '../graph/contract/service/acts.js';
import type { HarnessMissing, HarnessRegistry } from '../threads/contract/service/harness.js';
import { phase } from './phase.js';
import { ensureVocabulary } from '../graph/serving/birth.js';

export const bootServer = Effect.fnUntraced(function* () {
  yield* phase('machine vocabulary completed', ensureVocabulary('machine'));
  yield* phase('derived caches completed', (yield* BlockProjection).completeDerived());
});

export const recoverRuns = (harnesses: HarnessRegistry['Service']): Effect.Effect<void, HarnessFailure | HarnessMissing> =>
  phase(
    'run recovery triggered',
    Effect.forEach(harnesses.list(), (id) => Effect.flatMap(harnesses.resolve(id), (harness) => harness.recover()), {
      discard: true,
    }),
  );
