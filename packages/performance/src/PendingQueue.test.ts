import { expect, test } from 'bun:test';
import { PendingBuffer, PendingQueue, pendingClass } from './PendingQueue.js';
import type { PerformanceRecordKind } from './protocol/records.js';

test('a buffer hands its records over as one array, in submission order, and never twice', () => {
  const queue = new PendingQueue();
  const buffer = queue.push(new PendingBuffer(1, 'rest'));
  queue.append(buffer, '[{"id":"first"},"interval"]', 'vital', 'interval');
  queue.append(buffer, '[{"id":"second"},"interval"]', 'stall', 'interval');
  queue.append(buffer, '[{"id":"third"},"agent.step"]', 'metric', 'agent.step');
  expect(queue.size).toBe(3);
  expect(queue.depth).toBe(1);

  const records = buffer.take();
  expect(JSON.parse(new TextDecoder().decode(records))).toEqual([
    [{ id: 'first' }, 'interval'],
    [{ id: 'second' }, 'interval'],
    [{ id: 'third' }, 'agent.step'],
  ]);
  expect(records.byteLength).toBeGreaterThan(0);

  queue.remove(buffer);
  expect(queue.size).toBe(0);
  expect(queue.bytes).toBe(0);
  expect(queue.protectedKeys).toEqual([]);
});

test('every kind but span shares one buffer, and spans have their own', () => {
  expect(pendingClass('span')).toBe('span');
  for (const kind of ['stall', 'vital', 'metric', 'profile', 'memory', 'loss', 'command'] as const) {
    expect(pendingClass(kind satisfies PerformanceRecordKind)).toBe('rest');
  }
});

test('eviction takes every span buffer before the rare kinds, oldest first, and never the open rest', () => {
  const queue = new PendingQueue();
  const rest = sealed(queue, new PendingBuffer(1, 'rest'), 'vital');
  const oldestSpans = sealed(queue, new PendingBuffer(2, 'span'), 'span');
  const laterSpans = sealed(queue, new PendingBuffer(3, 'span'), 'span');
  const collecting = queue.push(new PendingBuffer(4, 'span'));
  queue.append(collecting, '[{"id":"newest"},"newest"]', 'span', 'newest');

  expect(queue.victim(collecting)).toBe(oldestSpans);
  queue.remove(oldestSpans);
  expect(queue.victim(collecting)).toBe(laterSpans);
  queue.remove(laterSpans);
  expect(queue.victim(collecting)).toBe(collecting);
  queue.remove(collecting);
  expect(queue.victim(undefined)).toBe(rest);
  expect(queue.victim(rest)).toBeUndefined();
});

test('a buffer in flight is never a victim', () => {
  const queue = new PendingQueue();
  const handed = sealed(queue, new PendingBuffer(1, 'span'), 'span');
  const waiting = sealed(queue, new PendingBuffer(2, 'span'), 'span');
  queue.post(handed);

  expect(queue.victim(undefined)).toBe(waiting);
  queue.remove(waiting);
  expect(queue.victim(undefined)).toBeUndefined();
  expect(queue.size).toBe(1);
  expect(queue.bytes).toBeGreaterThan(0);
});

test('the oldest sealed buffer is the next to cross, across both classes', () => {
  const queue = new PendingQueue();
  const spans = sealed(queue, new PendingBuffer(1, 'span'), 'span');
  const rest = sealed(queue, new PendingBuffer(2, 'rest'), 'vital');
  const open = queue.push(new PendingBuffer(3, 'span'));
  queue.append(open, '[{"id":"open"},"open"]', 'span', 'open');

  expect(queue.nextSealed()).toBe(spans);
  queue.post(spans);
  expect(queue.nextSealed()).toBe(rest);
  queue.remove(spans);
  queue.remove(rest);
  expect(queue.nextSealed()).toBeUndefined();
  queue.seal(open);
  expect(queue.nextSealed()).toBe(open);
});

test('protected keys are refcounted per group, and the array is built again only when the set changes', () => {
  const queue = new PendingQueue();
  queue.retain('trace');
  const first = queue.protectedKeys;
  expect(first).toEqual(['trace']);
  expect(queue.protectedKeys).toBe(first);

  const buffer = queue.push(new PendingBuffer(1, 'span'));
  queue.append(buffer, '[{"id":"a"},"trace"]', 'span', 'trace');
  expect(queue.protectedKeys).toBe(first);
  queue.append(buffer, '[{"id":"b"},"trace"]', 'span', 'trace');
  expect(queue.protectedKeys).toBe(first);

  const other = queue.push(new PendingBuffer(2, 'rest'));
  queue.append(other, '[{"id":"c"},"lonely"]', 'vital', 'lonely');
  expect(queue.protectedKeys).not.toBe(first);
  expect([...queue.protectedKeys].sort()).toEqual(['lonely', 'trace']);

  queue.remove(other);
  expect(queue.holds('lonely')).toBe(false);
  expect(queue.protectedKeys).toEqual(['trace']);

  queue.release('trace');
  expect(queue.holds('trace')).toBe(true);
  queue.remove(buffer);
  expect(queue.holds('trace')).toBe(false);
});

test('a buffer keeps one count per kind and one entry per segment, whatever it carries', () => {
  const queue = new PendingQueue();
  const buffer = queue.push(new PendingBuffer(1, 'rest'));
  for (let index = 0; index < 1_000; index += 1) {
    queue.append(buffer, `[{"id":"vital-${index}"},"interval"]`, 'vital', 'interval');
  }
  queue.append(buffer, '[{"id":"stall"},"interval"]', 'stall', 'interval');
  queue.append(buffer, '[{"id":"capture"},"capture"]', 'memory', 'capture');

  expect(buffer.records).toBe(1_002);
  expect([...buffer.kinds]).toEqual([
    ['vital', 1_000],
    ['stall', 1],
    ['memory', 1],
  ]);
  expect([...buffer.groups]).toEqual(['interval', 'capture']);
  expect(queue.size).toBe(1_002);
  expect(queue.depth).toBe(1);
});

function sealed(queue: PendingQueue, buffer: PendingBuffer, kind: PerformanceRecordKind): PendingBuffer {
  queue.push(buffer);
  const key = `segment-${buffer.sequence}`;
  queue.append(buffer, `[{"id":"${key}"},"${key}"]`, kind, key);
  queue.seal(buffer);
  return buffer;
}
