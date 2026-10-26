import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Git } from '@runlith/git/Git';
import { Effect } from 'effect';
import type { PreparedRemoval } from '../../change-record/contract/service/prepared.js';
import type { RuleViolation } from '../contract/wire/enforcement.js';
import { attributed, type Evidence, type Judged } from './excess.js';

const KEY = 'src/dup.ts × FORBIDDEN dup';
const THEIRS = 'amber-fox';

const at = (line?: number): RuleViolation => ({ fingerprint: KEY, file: 'src/dup.ts', line });

const touching =
  (added: readonly number[], removed: readonly number[]): Evidence =>
  () =>
    Effect.succeed(
      new Map([['src/dup.ts', { added: (line: number) => added.includes(line), removed: (line: number) => removed.includes(line) }]]),
    );

const judge = (peers: readonly number[], removals: Readonly<Record<number, PreparedRemoval>>): Judged => ({
  root: '/repo',
  base: 'base',
  built: 'built',
  holders: (lines) => Effect.succeed(lines.map(({ line }) => (peers.includes(line) ? [THEIRS] : []))),
  removers: (lines) => Effect.succeed(lines.map(({ line }) => removals[line] ?? { _tag: 'unknown' as const })),
});

const run = Effect.fnUntraced(function* (
  subject: Judged,
  evidence: Evidence,
  occurrences: readonly RuleViolation[],
  baseOccurrences: readonly RuleViolation[],
) {
  const rows = yield* attributed(subject, evidence, { violations: occurrences.slice(-1), occurrences, baseOccurrences }).pipe(
    Effect.provideService(Git, Git.of({ run: () => Effect.die('the evidence is handed in') })),
  );
  return { violations: rows.map((row) => row.violation), holders: rows.map((row) => row.holders) };
});

const placed = (rows: readonly RuleViolation[]) => rows.map(({ line }) => line);

it.effect(
  'a peer insertion above an old occurrence the session only edits is the peer’s excess, whichever order the occurrences come in',
  () =>
    Effect.gen(function* () {
      const subject = judge([1], { 1: { _tag: 'own' } });
      for (const occurrences of [
        [at(1), at(2)],
        [at(2), at(1)],
      ]) {
        const answer = yield* run(subject, touching([1, 2], [1]), occurrences, [at(1)]);
        expect(placed(answer.violations)).toEqual([1]);
        expect(answer.holders).toEqual([[THEIRS]]);
      }
    }),
);

it.effect('the session’s own addition refuses in either order, and a removal no record proves is credited to nobody', () =>
  Effect.gen(function* () {
    for (const removal of [{ _tag: 'peer', holder: THEIRS }, { _tag: 'unknown' }] as const) {
      const subject = judge([2], { 1: removal });
      for (const occurrences of [
        [at(1), at(2)],
        [at(2), at(1)],
      ]) {
        const answer = yield* run(subject, touching([1, 2], [1]), occurrences, [at(1)]);
        expect(placed(answer.violations).sort()).toEqual([1, 2]);
        expect(answer.holders.map((held) => held.length).sort()).toEqual([0, 1]);
      }
    }
    const answer = yield* run(judge([], {}), touching([2], []), [at(1), at(2)], [at(1)]);
    expect(placed(answer.violations)).toEqual([2]);
    expect(answer.holders).toEqual([[]]);
  }),
);

it.effect('an occurrence with no line cannot be a peer’s: it stays the session’s own beside an old one on a peer-edited line', () =>
  Effect.gen(function* () {
    const subject = judge([1], { 1: { _tag: 'peer', holder: THEIRS } });
    for (const occurrences of [
      [at(), at(1)],
      [at(1), at()],
    ]) {
      const answer = yield* run(subject, touching([1], [1]), occurrences, [at(1)]);
      expect(answer.holders.some((held) => held.length === 0)).toBe(true);
      expect(answer.violations).toHaveLength(2);
    }
  }),
);

it.effect('every base occurrence on a line the session replaced is credited, so a peer addition is not refused for them', () =>
  Effect.gen(function* () {
    const subject = judge([3], { 1: { _tag: 'own' } });
    for (const occurrences of [
      [at(2), at(2), at(3)],
      [at(3), at(2), at(2)],
    ]) {
      const answer = yield* run(subject, touching([2, 3], [1]), occurrences, [at(1), at(1)]);
      expect(placed(answer.violations)).toEqual([3]);
      expect(answer.holders).toEqual([[THEIRS]]);
    }
  }),
);
