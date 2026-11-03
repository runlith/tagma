import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Git } from '@runlith/git/Git';
import { Effect } from 'effect';
import type { RuleViolation } from '../contract/wire/enforcement.js';
import { attributed, type Evidence, type Judged } from './excess.js';

const KEY = 'src/dup.ts × FORBIDDEN dup';
const THEIRS = 'amber-fox';

const at = (line?: number): RuleViolation => ({ fingerprint: KEY, file: 'src/dup.ts', line });

const touching =
  (added: readonly number[]): Evidence =>
  () =>
    Effect.succeed(
      new Map([['src/dup.ts', { added: (line: number) => (added.includes(line) ? 0 : undefined), removed: () => undefined }]]),
    );

const judge = (peers: readonly number[]): Judged => ({
  root: '/repo',
  base: 'base',
  built: 'built',
  holders: (lines) => Effect.succeed(lines.map(({ line }) => (peers.includes(line) ? [THEIRS] : []))),
});

const run = Effect.fnUntraced(function* (subject: Judged, evidence: Evidence, occurrences: readonly RuleViolation[]) {
  const rows = yield* attributed(subject, evidence, { violations: occurrences.slice(-1), occurrences }).pipe(
    Effect.provideService(Git, Git.of({ run: () => Effect.die('the evidence is handed in') })),
  );
  return rows.map((row) => ({ line: row.violation.line, holders: row.holders }));
});

it.effect('every added occurrence of a new crossing is named whoever wrote it, each with the other writers of its line', () =>
  Effect.gen(function* () {
    for (const occurrences of [
      [at(1), at(2)],
      [at(2), at(1)],
    ]) {
      const answer = yield* run(judge([2]), touching([1, 2]), occurrences);
      expect([...answer].sort((left, right) => (left.line ?? 0) - (right.line ?? 0))).toEqual([
        { line: 1, holders: [] },
        { line: 2, holders: [THEIRS] },
      ]);
    }
  }),
);

it.effect('a crossing whose occurrences stand on no added line keeps the place the inspection named', () =>
  Effect.gen(function* () {
    expect(yield* run(judge([1]), touching([]), [at(1), at(2)])).toEqual([{ line: 2, holders: [] }]);
  }),
);
