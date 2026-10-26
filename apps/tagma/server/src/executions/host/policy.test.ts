import { totalmem } from 'node:os';
import { expect, test } from 'bun:test';
import { reserveOf } from '@runlith/executions/protocol/capacity';
import { executionGrant, executionPolicy, executionRecordCredits, executionWireLimits } from './policy.js';

const KiB = 1024;
const MiB = 1024 * KiB;

test('a pty is born at a grid a real display fills', () => {
  const geometry = executionPolicy.execution.geometry;
  expect(geometry.columns).toBe(320);
  expect(geometry.columns * 10.8).toBeGreaterThanOrEqual(3456);
  expect(geometry.rows).toBe(100);
  expect(geometry.rows * 18).toBeGreaterThanOrEqual(1800);
  expect(geometry.scrollbackRows).toBe(5000);
});

test('the interpreter budget funds every cell the declared screen keeps', () => {
  const { geometry, parser } = executionPolicy.execution;
  const cells = geometry.columns * (geometry.rows + geometry.scrollbackRows + geometry.rows);
  expect(cells).toBe(1_664_000);
  expect(parser.cellBytes).toBe(224 * MiB);
  expect(parser.cellBytes).toBeGreaterThanOrEqual(Math.ceil(cells * 126.4 * 1.11));
  expect(reserveOf(executionPolicy.execution, 'pty')).toBeLessThan(parser.cellBytes);
});

test('a presentation frame can carry the whole viewport it is declared for', () => {
  const { geometry, frame } = executionPolicy.execution;
  const perCell = 319 + 1 + 3;
  const visible = geometry.rows * (52 + geometry.columns * perCell) + 3330;
  expect(visible).toBeLessThanOrEqual(frame.bytes);
  expect(frame.bytes).toBe(16 * MiB);
  expect(executionWireLimits.frameBytes).toBeGreaterThanOrEqual(frame.bytes);
});

test('a terminal of this policy reserves its own live screen, and a pipes execution reserves no screen at all', () => {
  expect(reserveOf(executionPolicy.execution, 'pty')).toBe(10_416_128);
  expect(reserveOf(executionPolicy.execution, 'pipes')).toBe(2_457_600);
});

test('the grant is a quarter of this machine, and the readers this side declares follow what it funds', () => {
  expect(executionGrant.share).toBe(0.25);
  expect(executionGrant.machineBytes).toBe(totalmem());
  expect(executionGrant.grantBytes).toBe(Math.floor(0.25 * totalmem()));
  const funded = Math.floor(executionGrant.grantBytes / reserveOf(executionPolicy.execution, 'pty'));
  expect(executionWireLimits.subscriptions).toBe(funded * executionPolicy.execution.read.readers);
});

test('a byte subscription is granted one read chunk in flight, never the wire ceiling', () => {
  expect(executionRecordCredits).toBeGreaterThan(executionPolicy.execution.read.chunkBytes);
  expect(executionRecordCredits).toBeLessThan(executionWireLimits.credits);
});
