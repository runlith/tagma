import { expect, test } from 'bun:test';
import { StatementMetrics } from './StatementMetrics.js';

test('a bounded census resets admission without charging old replies to its new window', () => {
  const metrics = new StatementMetrics();
  const outstanding = metrics.query('SELECT 1 AS value');
  outstanding.statements++;
  for (let n = 0; n < 1024; n++) metrics.query(`SELECT 1 AS "field_${n}"`).statements++;
  const full = metrics.read({ limit: 1025 });
  expect(full.total).toBe(1025);
  expect(full.rows.find((row) => row.fingerprint === 'overflow')?.statements).toBe(1);
  const refused = metrics.query('SELECT 2 AS "late_field"');
  expect(metrics.query('SELECT 2 AS "late_field"')).toBe(refused);
  refused.statements++;
  expect(metrics.read({ limit: 1025 }).rows.find((row) => row.fingerprint === 'overflow')?.statements).toBe(2);

  metrics.reset();
  outstanding.completed++;
  const current = metrics.query('SELECT 3 AS value');
  current.statements++;
  const reset = metrics.read({ limit: 2 });
  expect(reset.censusId).not.toBe(full.censusId);
  expect(reset.total).toBe(1);
  expect(reset.rows[0]).toMatchObject({ statements: 1, completed: 0 });
  expect(current).not.toBe(outstanding);
});
