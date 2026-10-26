import { QuotaObservation, QuotaWindow } from '@runlith/llm/schema/quota';
import { expect, test } from 'vitest';
import { figureText, usageFigures } from './windows.js';

const NOW = Date.parse('2026-09-02T12:00:00Z');

function figures(windows: readonly QuotaWindow[]) {
  return usageFigures(new QuotaObservation({ observedAt: new Date(NOW), source: 'usage', windows }));
}

test('a bounded window is named by its span, and a weekly one by its definition when the vendor sent no length', () => {
  const [session, weekly, monthly, bucket] = figures([
    new QuotaWindow({ kind: 'session', usedPercent: 7, windowMinutes: 300, resetsAt: (NOW + 4.5 * 3_600_000) / 1000 }),
    new QuotaWindow({ kind: 'weekly', usedPercent: 74 }),
    new QuotaWindow({ kind: 'monthly', usedPercent: 12, windowMinutes: 43_200 }),
    new QuotaWindow({ kind: 'bucket', label: 'codex_other', usedPercent: 70, windowMinutes: 15 }),
  ]);

  expect(session?.name).toBe('5h');
  expect(weekly?.name).toBe('7d');
  expect(monthly?.name).toBe('30d');
  expect(bucket?.name).toBe('codex_other');
  expect(figureText(session!, NOW)).toBe('7% 5h · 4h 30m');
  expect(figureText(weekly!, NOW)).toBe('74% 7d');
});

test('a session window whose vendor sent no length carries no word rather than an invented one', () => {
  const [session] = figures([new QuotaWindow({ kind: 'session', usedPercent: 36, resetsAt: (NOW + 3_600_000) / 1000 })]);
  expect(session?.name).toBeNull();
  expect(figureText(session!, NOW)).toBe('36% · 1h');
});
