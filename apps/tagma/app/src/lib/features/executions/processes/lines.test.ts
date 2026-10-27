import { describe, expect, test } from 'vitest';
import { badgeWord, elapsedMs, isLive, isNearLimit, portUrl, unstartedNote, type ProcessLine } from './lines.js';

const NOW = 1_700_000_000_000;

const line = (over: Partial<ProcessLine> = {}): ProcessLine => ({
  key: over.address === undefined ? 'exec-1:0' : `${over.address.execution}:${over.address.incarnation}`,
  address: { execution: 'exec-1', incarnation: 0 },
  kind: 'command',
  owner: { thread: 'thread-1', label: 'check-adoption', internal: false, archived: false },
  wait: 'foreground',
  phase: 'running',
  live: 'held',
  label: null,
  command: 'bun --cwd apps/tagma/server typecheck',
  cwd: null,
  note: null,
  ports: [],
  startedAt: NOW - 161_000,
  endedAt: null,
  ranMs: null,
  exit: null,
  limit: { executionMs: 360_000, ceilingMs: 14_400_000, revision: 0, expiresAt: NOW + 199_000, origin: 'default' },
  waitMs: null,
  transport: 'pipes',
  opens: false,
  printed: null,
  stoppedByLimit: false,
  outer: false,
  unstarted: null,
  place: null,
  current: null,
  currentPid: null,
  ...over,
});

describe('a line with no clock reads no span', () => {
  test('queued work has no clock: no elapsed, and never near its limit', () => {
    const queued = line({ phase: 'queued', startedAt: null, limit: { ...line().limit!, expiresAt: null } });
    expect(elapsedMs(queued, NOW)).toBeNull();
    expect(isNearLimit(queued, NOW)).toBe(false);
  });

  test('an ended line whose ending nobody stamped prints no span rather than a clock still ticking', () => {
    expect(elapsedMs(line({ phase: 'ended' }), NOW + 60_000)).toBeNull();
    expect(elapsedMs(line({ phase: 'ended', endedAt: NOW - 1_000 }), NOW + 60_000)).toBe(160_000);
  });

  test('an ended command reads the time its host measured it running, not the span of whatever waited on it', () => {
    expect(elapsedMs(line({ phase: 'ended', startedAt: null, ranMs: 51_000 }), NOW + 600_000)).toBe(51_000);
  });
});

describe('amber is the limit, measured against an armed clock', () => {
  test('within a minute of the limit, or being stopped by it, and not otherwise', () => {
    expect(isNearLimit(line(), NOW)).toBe(false);
    expect(isNearLimit(line({ limit: { ...line().limit!, expiresAt: NOW + 59_000 } }), NOW)).toBe(true);
    expect(isNearLimit(line({ phase: 'stopping', stoppedByLimit: true }), NOW)).toBe(true);
    expect(isNearLimit(line({ kind: 'terminal', wait: null, limit: null }), NOW)).toBe(false);
  });
});

describe('a line is named by one word', () => {
  test('the word is the label first, the command line next, and never the interpreter beside them', () => {
    expect(badgeWord(line({ label: 'Typecheck the tree', command: '/bin/sh' }))).toBe('typecheck');
    expect(badgeWord(line({ command: 'bun run --cwd apps/tagma/app typecheck' }))).toBe('typecheck');
    expect(badgeWord(line({ command: null }))).toBe('command');
  });

  test('a reference the host holds nothing under is not live; one it cannot read still is', () => {
    expect(isLive(line({ phase: null, live: 'unheld' }))).toBe(false);
    expect(isLive(line({ phase: null, live: 'unavailable' }))).toBe(true);
  });
});

describe('a never-started ending is worded once, whatever the host put in front of its reason', () => {
  test('the cause the host named is lifted into the phrase, and an unnamed one is left alone', () => {
    expect(unstartedNote('not-started: queued 2000ms behind 6 of 12 slots granted')).toBe(
      'not started · queued 2000ms behind 6 of 12 slots granted',
    );
    expect(unstartedNote('explicit-stop: stop:op-1')).toBe('stopped before it started · stop:op-1');
    expect(unstartedNote('the spawner refused: EAGAIN')).toBe('not started · the spawner refused: EAGAIN');
  });
});

describe('a measured listener links where this machine answers it', () => {
  test('loopback and wildcard binds are a localhost link; a specific bind is not', () => {
    expect(portUrl('::1', 6111)).toBe('http://localhost:6111/');
    expect(portUrl('127.0.0.1', 5173)).toBe('http://localhost:5173/');
    expect(portUrl('0.0.0.0', 8080)).toBe('http://localhost:8080/');
    expect(portUrl('*', 3000)).toBe('http://localhost:3000/');
    expect(portUrl('192.168.1.20', 8080)).toBeNull();
  });
});
