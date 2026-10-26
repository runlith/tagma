import { expect, test } from 'bun:test';
import { enforcementText } from './engineVoice.js';

test("a rule's reading says its general fix once over every list whose rows name none of their own", () => {
  const general = 'Import another module only along a relation.';
  const refused = {
    id: 1,
    rule: 'aaaaaaaa',
    op: 'submit_work',
    file: 'src/core/boot.ts',
    line: 1,
    fingerprint: 'app -> core @ core/boot.ts',
    said: null,
    reached: '../app/main',
    fix: null,
    base: null,
    branch: null,
    actor: null,
    at: '2026-10-20T10:00:00.000Z',
    times: 2,
    first: '2026-10-19T10:00:00.000Z',
  };
  const text = enforcementText({
    status: 'ok',
    rule: 'aaaaaaaa',
    norm: { rule: 'aaaaaaaa', title: 'Import only downward', strictness: 'gate', generalFix: general },
    refusals: { rows: [refused, { ...refused, id: 2, fingerprint: 'other', fix: 'load it from core' }], total: 2, times: 3, next: null },
    escaped: {
      rows: [{ fingerprint: 'escaped', path: 'src/core/late.ts', said: 'loads `../app/main`', commit: 'c'.repeat(40) }],
      total: 1,
      next: null,
    },
    graph: null,
  });
  expect(text.split(general)).toHaveLength(2);
  expect(text).toContain(`fix where a place names none: ${general}`);
  expect(text).toContain('×2 since 2026-10-19T10:00:00.000Z: src/core/boot.ts:1 reached `../app/main`');
  expect(text).toContain('\n    fix: load it from core');
});
