import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Git } from '@runlith/git/Git';
import { Effect, Result } from 'effect';
import type { RuleViolation } from '../contract/wire/enforcement.js';
import type { Evidence } from './excess.js';
import { againstParents, type Reading, UNBOUND } from './merged.js';

const KEY = 'src/dup.ts × FORBIDDEN dup';

const at = (line: number): RuleViolation => ({ fingerprint: KEY, file: 'src/dup.ts', line });

const adding =
  (added: readonly number[]): Evidence =>
  () =>
    Effect.succeed(new Map([['src/dup.ts', { added: (line: number) => added.includes(line), removed: () => false }]]));

type Parent = { readonly reading: Reading; readonly added: readonly number[] };

const judged = (first: Parent, second: Parent) =>
  againstParents(
    Result.succeed([{ base: 'second', paths: ['src/dup.ts'], evidence: adding(second.added) }]),
    { base: 'first', paths: ['src/dup.ts'], evidence: adding(first.added) },
    UNBOUND,
    (base) => Effect.succeed(base === 'first' ? first.reading : second.reading),
    (changed) => changed,
  ).pipe(
    Effect.map((reading) => reading.verdict.violations.map(({ line }) => line)),
    Effect.provideService(Git, Git.of({ run: () => Effect.die('the evidence is handed in') })),
  );

const counted = (violations: readonly RuleViolation[], occurrences: readonly RuleViolation[]): Reading => ({
  verdict: { violations, unjudged: [], occurrences, baseOccurrences: [] },
});

it.effect('occurrences of one fingerprint that each parent brings stand, and only the line neither parent holds is new', () =>
  Effect.gen(function* () {
    expect(
      yield* judged({ reading: counted([at(2)], [at(1), at(2)]), added: [2] }, { reading: counted([at(2)], [at(1), at(2)]), added: [1] }),
    ).toEqual([]);
    expect(
      yield* judged(
        { reading: counted([at(2), at(3)], [at(1), at(2), at(3)]), added: [2, 3] },
        { reading: counted([at(3)], [at(1), at(2), at(3)]), added: [3] },
      ),
    ).toEqual([3]);
  }),
);

it.effect('a crossing new against both parents stays new on a line one of them already held', () =>
  Effect.gen(function* () {
    const fresh: Reading = { verdict: { violations: [at(1)], unjudged: [] } };
    expect(yield* judged({ reading: fresh, added: [] }, { reading: fresh, added: [1] })).toEqual([1]);
  }),
);
