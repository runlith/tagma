import { expect, test } from 'bun:test';
import type { CheckAnswer } from './contract/wire/enforcement.js';
import { refusalLines } from '@runlith/agent/tool/refusal';
import { checkedText } from './voice.js';

test('the check report carries an index refusal even when no tree or violation could be read', () => {
  const refusal = {
    code: 'inspection-failed' as const,
    reason: '/scratch/assets.index is not an index of this checkout’s git directory',
    unblock: ['name an index in /checkout/.git'] as const,
  };
  const answer: CheckAnswer & { readonly status: 'ok' } = {
    status: 'ok',
    over: 'staged',
    head: '',
    paths: [],
    violations: [],
    shown: 0,
    total: 0,
    next: null,
    fingerprints: [],
    unjudged: [],
    rules: [],
    refuses: true,
    refusal,
    reader: { startedAt: '2026-10-15T12:00:00Z', revision: { head: 'reader-revision', dirty: false } },
  };
  expect(checkedText(answer)).toContain(refusalLines(refusal).join('\n'));
  expect(checkedText(answer)).toContain('reader-revision');
  const watch = {
    rule: 'watch-rule',
    title: 'Domain code never loads the UI',
    strictness: 'watch' as const,
    fingerprint: 'watch-crossing',
    file: 'src/watch.ts',
    line: 2,
    message: 'loads @law-lab/ui',
    fix: 'load @law-lab/format instead',
    generalFix: 'move the load out of the domain',
  };
  const bare = { ...watch, fingerprint: 'bare-crossing', file: 'src/bare.ts', line: 3, fix: undefined };
  const judged = checkedText({
    ...answer,
    head: '0123456789012345678901234567890123456789',
    paths: [watch.file, bare.file],
    violations: [watch, bare],
    shown: 2,
    total: 3,
    next: 'next-page-cursor',
    fingerprints: [watch.fingerprint, bare.fingerprint],
    bodies: { 'watch-rule': 'A test of the domain may load the UI.' },
    unjudged: [{ rule: 'watch-rule', file: 'src/unjudged.ts', line: 1, specifier: 'unresolved-import' }],
    rules: [{ rule: 'watch-rule', strictness: 'watch', ms: 1, reached: true }],
    refusal: { code: 'rule-violated', reason: 'gated-crossing', unblock: ['repair src/gate.ts'] },
  });
  for (const value of [watch.fingerprint, 'next-page-cursor', 'src/unjudged.ts', 'unresolved-import', 'gated-crossing']) {
    expect(judged).toContain(value);
  }
  expect(judged).toContain(
    [
      `[[watch-rule|${watch.title}]] · watch`,
      '  A test of the domain may load the UI.',
      `  fix where a place names none: ${watch.generalFix}`,
      '  src/watch.ts:2 loads @law-lab/ui',
      `    fix: ${watch.fix}`,
      '  src/bare.ts:3 loads @law-lab/ui',
    ].join('\n'),
  );
  expect(judged.split(watch.generalFix)).toHaveLength(2);
});
