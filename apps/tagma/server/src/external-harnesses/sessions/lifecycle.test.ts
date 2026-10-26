import { expect, test } from 'bun:test';
import { NamespaceId } from '@runlith/files/namespace';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { EnvironmentId } from '../../workspace/contract/wire/environments.js';
import type { HarnessSession, HarnessStorage } from '../../threads/contract/wire/harness/session.js';
import { recordStorageGate } from './lifecycle.js';

const binding = {
  environmentId: EnvironmentId.make('env-1'),
  kind: 'host' as const,
  namespaceId: NamespaceId.make('ns-1'),
  identityWitness: { provider: 'test', format: 'test', token: 'witness-1' },
};
const storage: HarnessStorage = { binding, entries: [{ name: 'HOME', value: '/home/test' }] };

const life = (overrides: Partial<HarnessSession>): HarnessSession => ({
  id: 'session-1',
  origin: 'launched',
  state: 'starting',
  prompt: '',
  cwd: null,
  argv: null,
  ownerId: null,
  startedAt: '2026-09-14T00:00:00.000Z',
  heartbeatAt: '2026-09-14T00:00:00.000Z',
  ...overrides,
});

const refusalCode = (verdict: unknown): string => {
  if (!(verdict instanceof GateRefusal)) throw new Error('expected a refusal');
  return verdict.code;
};

test('launch storage is recorded while launching or winding down, kept when identical, refused otherwise', () => {
  expect(recordStorageGate(life({}), 'session-1', storage)).toBe('record');
  expect(recordStorageGate(life({ state: 'stopping' }), 'session-1', storage)).toBe('record');
  expect(recordStorageGate(life({ storage }), 'session-1', storage)).toBe('keep');
  expect(recordStorageGate(life({ state: 'stopping', storage }), 'session-1', storage)).toBe('keep');
  expect(refusalCode(recordStorageGate(life({}), 'session-2', storage))).toBe('stale-execution');
  expect(refusalCode(recordStorageGate(undefined, 'session-1', storage))).toBe('stale-execution');
  expect(refusalCode(recordStorageGate(life({ state: 'running' }), 'session-1', storage))).toBe('stale-execution');
  expect(refusalCode(recordStorageGate(life({ state: 'ended' }), 'session-1', storage))).toBe('stale-execution');
  const other: HarnessStorage = { ...storage, entries: [{ name: 'HOME', value: '/home/other' }] };
  expect(refusalCode(recordStorageGate(life({ storage }), 'session-1', other))).toBe('storage-changed');
});
