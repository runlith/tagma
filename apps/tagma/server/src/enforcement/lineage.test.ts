import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import type { Assembled } from '@tagma/inspection/builtins';
import { Git } from '@runlith/git/Git';
import { Effect, Result } from 'effect';
import type { RuleViolation } from './contract/wire/enforcement.js';
import { followedDebt, needsLineage, renamedBetween } from './lineage.js';

const names = {
  builtin: 'names',
  params: {
    base: 'src',
    files: { extensions: ['.ts'], exclude: [] },
    uncovered: [],
    modules: [],
    services: ['Context.Service'],
    errors: ['Error'],
    checks: {},
    glossary: [],
  },
} as Assembled;

const reexports: Assembled = { builtin: 'reexports', params: { base: 'src', allows: [], files: { extensions: ['.ts'], exclude: [] } } };

const found = (entries: Record<string, number | undefined>): ReadonlyMap<string, RuleViolation> =>
  new Map(Object.entries(entries).map(([fingerprint, value]) => [fingerprint, { fingerprint, file: '', value }]));

describe('debt lineage', () => {
  it("moves an entry onto the fingerprint its file's rename relocates it to, keeping the owner and taking the measured value", () => {
    const debt = [
      { fingerprint: 'F4 a/big.ts', owner: 'task-1', value: 700 },
      { fingerprint: 'S2 a/big.ts#ThreadRow', owner: 'task-1' },
      { fingerprint: 'F4 c/kept.ts', owner: 'task-2', value: 650 },
    ];
    const now = found({ 'F4 b/big.ts': 690, 'S2 b/big.ts#ThreadRow': undefined, 'F4 c/kept.ts': 650 });
    expect(needsLineage(debt, now)).toBe(true);
    expect(followedDebt(names, debt, now, [{ from: 'src/a/big.ts', to: 'src/b/big.ts' }])).toEqual([
      { fingerprint: 'F4 b/big.ts', owner: 'task-1', value: 690 },
      { fingerprint: 'S2 b/big.ts#ThreadRow', owner: 'task-1' },
      { fingerprint: 'F4 c/kept.ts', owner: 'task-2', value: 650 },
    ]);
  });

  it.effect('refuses a failed rename reading instead of claiming there were no renames', () =>
    Effect.gen(function* () {
      const git = Git.of({
        run: () => Effect.succeed({ status: 128, stdout: '', stderr: 'bad revision', overflow: false, messageOverflow: false }),
      });
      const answer = yield* Effect.result(renamedBetween('/checkout', 'old', 'new', 'src').pipe(Effect.provideService(Git, git)));
      expect(Result.isFailure(answer) && answer.failure.code).toBe('inspection-failed');
    }),
  );

  it('moves an entry onto a renamed file that grew, and nothing onto a fingerprint no rename names or for a builtin whose violations do not follow', () => {
    const debt = [{ fingerprint: 'F4 a/big.ts', owner: 'task-1', value: 700 }];
    const renamed = [{ from: 'src/a/big.ts', to: 'src/b/big.ts' }];
    expect(followedDebt(names, debt, found({ 'F4 b/big.ts': 720 }), renamed)).toEqual([
      { fingerprint: 'F4 b/big.ts', owner: 'task-1', value: 720 },
    ]);
    expect(followedDebt(names, debt, found({ 'F4 d/other.ts': 690 }), renamed)).toEqual(debt);
    const forwarded = [{ fingerprint: 'core/a.ts', owner: 'task-1' }];
    expect(followedDebt(reexports, forwarded, found({ 'core/b.ts': undefined }), [{ from: 'src/core/a.ts', to: 'src/core/b.ts' }])).toEqual(
      forwarded,
    );
  });
});
