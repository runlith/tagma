import { QuotaObservation, QuotaWindow } from '@runlith/llm/schema/quota';
import { expect, test } from 'vitest';
import { paceOf } from './pace.js';
import { figureReading } from '../usage/thresholds.js';
import { usageFigures } from '../usage/windows.js';

const NOW = Date.parse('2026-09-02T12:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function figure(window: ConstructorParameters<typeof QuotaWindow>[0]) {
  const [only] = usageFigures(new QuotaObservation({ observedAt: new Date(NOW), source: 'usage', windows: [new QuotaWindow(window)] }));
  if (only === undefined) throw new Error('No figure.');
  return only;
}

test('a window spending faster than it refills warns with the moment it runs dry; one that lasts stays plain', () => {
  const hot = figure({ kind: 'weekly', usedPercent: 44, windowMinutes: 10_080, resetsAt: (NOW + (5 * DAY + 19 * HOUR)) / 1000 });
  const reading = figureReading(hot, NOW);
  expect(reading.tone).toBe('warning');
  expect(reading.emptyAt).not.toBeNull();
  expect(Math.round(((reading.emptyAt ?? 0) - NOW) / HOUR)).toBe(37);

  const calm = figure({ kind: 'session', usedPercent: 3, windowMinutes: 1_440, resetsAt: (NOW + 6 * HOUR) / 1000 });
  expect(figureReading(calm, NOW)).toEqual({ tone: 'plain', emptyAt: null });
});

test('a spent window alarms whatever its pace', () => {
  const spent = figure({ kind: 'weekly', usedPercent: 97, windowMinutes: 10_080, resetsAt: (NOW + DAY) / 1000 });
  expect(figureReading(spent, NOW)).toEqual({ tone: 'alarm', emptyAt: null });
});

test('where the pace cannot be judged the tight threshold decides', () => {
  const early = figure({ kind: 'weekly', usedPercent: 50, windowMinutes: 10_080, resetsAt: (NOW + 6.5 * DAY) / 1000 });
  expect(paceOf(early, NOW)?.judged).toBe(false);
  expect(figureReading(early, NOW).tone).toBe('plain');

  const lengthless = figure({ kind: 'bucket', label: 'burst', usedPercent: 85, resetsAt: (NOW + HOUR) / 1000 });
  expect(paceOf(lengthless, NOW)).toBeNull();
  expect(figureReading(lengthless, NOW)).toEqual({ tone: 'warning', emptyAt: null });

  const granted = figure({ kind: 'weekly', usedPercent: 40, windowMinutes: 10_080, resetsAt: (NOW - HOUR) / 1000 });
  expect(paceOf(granted, NOW)).toBeNull();
});

test('a weekly window the vendor sent without a length runs seven days, a monthly one a calendar month', () => {
  const weekly = paceOf(figure({ kind: 'weekly', usedPercent: 10, resetsAt: (NOW + 3.5 * DAY) / 1000 }), NOW);
  expect(weekly?.elapsed).toBeCloseTo(0.5);

  const resetsAt = Date.parse('2026-09-12T12:00:00Z');
  const monthly = paceOf(figure({ kind: 'monthly', usedPercent: 10, resetsAt: resetsAt / 1000 }), NOW);
  expect(monthly?.elapsed).toBeCloseTo(21 / 31);
});
