import { parseTextPatch } from '@runlith/utils/patch';
import { expect, test } from 'vitest';
import { diffState, patchIdentity } from './diffState';

const patch = (count: number): string =>
  [`@@ -1,${count} +1,${count} @@`, ...Array.from({ length: count }, (_unused, index) => ` line ${index}`)].join('\n');

test('a reading re-made over the same file answers the same name, and a wider one does not', () => {
  const hunks = parseTextPatch(patch(40));

  expect(patchIdentity(hunks, 'src/report.ts')).toBe(patchIdentity(parseTextPatch(patch(40)), 'src/report.ts'));
  expect(patchIdentity(hunks, 'src/report.ts')).not.toBe(patchIdentity(parseTextPatch(patch(80)), 'src/report.ts'));
  expect(patchIdentity(hunks, 'src/report.ts')).not.toBe(patchIdentity(hunks, 'src/other.ts'));
  expect(patchIdentity(patch(40), 'src/report.ts')).toBe(patchIdentity(patch(40), 'src/report.ts'));
});

test('git counting no lines answers before anything is measured', () => {
  expect(diffState({ patch: patch(4), binary: true, timedOut: false, asked: false })).toEqual({ kind: 'binary' });
});

test('a patch past the hard ceiling reports a floor, and the measure stopped there', () => {
  const huge = patch(400_000);
  const state = diffState({ patch: huge, binary: false, timedOut: false, asked: false });

  expect(state.kind).toBe('oversized');
  expect(state.kind === 'oversized' && state.atLeast).toBeLessThan(400_000);
  expect(diffState({ patch: huge, binary: false, timedOut: false, asked: true }).kind).toBe('oversized');
});

test('a patch past the soft ceiling waits behind a press, and the press draws it', () => {
  const large = patch(12_000);

  const waiting = diffState({ patch: large, binary: false, timedOut: false, asked: false });
  expect(waiting.kind).toBe('deferred');
  expect(waiting.kind === 'deferred' && waiting.lines).toBeGreaterThan(12_000);

  const drawn = diffState({ patch: large, binary: false, timedOut: false, asked: true });
  expect(drawn.kind === 'rows' && drawn.hunks[0]?.lines).toHaveLength(12_000);
});

test('a patch too long to measure says so rather than calling itself large', () => {
  const wide = ['@@ -1,1 +1,1 @@', ` ${'a'.repeat(4_000_000)}`, `+${'b'.repeat(4_000_001)}`].join('\n');

  expect(diffState({ patch: wide, binary: false, timedOut: false, asked: false })).toEqual({ kind: 'unmeasured' });

  const drawn = diffState({ patch: wide, binary: false, timedOut: false, asked: true });
  expect(drawn.kind === 'rows' && drawn.hunks[0]?.lines).toHaveLength(2);
});

test('a patch stating no stretches says the working file is what HEAD carries', () => {
  expect(diffState({ patch: '', binary: false, timedOut: false, asked: false })).toEqual({ kind: 'identical' });
  expect(diffState({ patch: [], binary: false, timedOut: false, asked: false })).toEqual({ kind: 'identical' });
});

test('a comparison that ran out of time still hands its rows over, marked', () => {
  const hunks = parseTextPatch(patch(2));
  const state = diffState({ patch: hunks, binary: false, timedOut: true, asked: false });

  expect(state.kind).toBe('partial');
  expect(state.kind === 'partial' && state.hunks).toBe(hunks);
});

test('already-parsed stretches meet the same soft ceiling', () => {
  const wide = parseTextPatch(patch(12_000));

  expect(diffState({ patch: wide, binary: false, timedOut: false, asked: false }).kind).toBe('deferred');
  expect(diffState({ patch: wide, binary: false, timedOut: false, asked: true }).kind).toBe('rows');
});
