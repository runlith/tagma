import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
import { expect, test } from 'vitest';
import { transportOffer } from './transport.js';
import type { HarnessPresentation } from '@tagma/server/threads/contract/wire/harness/externalSession';

const SHARED: HarnessPresentation = {
  label: 'CLI',
  iconProvider: null,
  mark: null,
  install: null,
  modelProvider: null,
  terminal: true,
  acp: true,
  hosted: true,
  sharedSessions: true,
};
const SEPARATE: HarnessPresentation = { ...SHARED, sharedSessions: false };

const CAPABILITIES = {
  messaging: true,
  judgedModel: false,
  history: 'none',
  compaction: 'none',
  modelMove: 'pinned',
  openings: 'core',
  pictures: true,
  law: null,
  touch: null,
  authorship: null,
} as const;

const native = (life: 'idle' | 'working', presentation: HarnessPresentation = SHARED): ThreadListRow =>
  ({
    id: 'thread-1',
    life,
    outcome: null,
    parentThreadId: null,
    activeRunId: life === 'working' ? 'run-1' : null,
    harness: null,
    cli: { name: 'claude-code', presentation },
  }) as unknown as ThreadListRow;

const row = (
  name: 'claude-code' | 'cursor' | 'devin',
  transport: 'terminal' | 'acp',
  life: 'idle' | 'working',
  process: 'running' | 'ended' | null,
  presentation: HarnessPresentation = SHARED,
): ThreadListRow =>
  ({
    id: 'thread-1',
    life,
    outcome: null,
    parentThreadId: null,
    activeRunId: life === 'working' ? 'run-1' : null,
    cli: null,
    harness: {
      name,
      presentation,
      transport,
      agent: null,
      capabilities: CAPABILITIES,
      model: null,
      effort: null,
      asked: null,
      execution: null,
      question: null,
      process: process === null ? null : { id: 's-1', state: process, startedAt: '2026-01-01T09:00:00.000Z' },
      observation: { binding: { sessionId: null, execution: null, rootKey: null }, revision: 0, diagnostics: [] },
    },
  }) as unknown as ThreadListRow;

test('a harness thread offers the other transport its vendor serves, an idle held process included, and holds still during a turn', () => {
  expect(transportOffer(row('devin', 'acp', 'idle', 'running'))).toMatchObject({ to: 'terminal', turning: false });
  expect(transportOffer(row('claude-code', 'terminal', 'idle', 'ended'))).toMatchObject({ to: 'acp', turning: false });
  expect(transportOffer(row('devin', 'acp', 'working', 'running'))?.turning).toBe(true);
  expect(transportOffer(row('cursor', 'terminal', 'idle', null, SEPARATE))).toBeNull();
  expect(transportOffer(row('cursor', 'acp', 'idle', 'running', SEPARATE))).toBeNull();
  expect(transportOffer(native('idle', SEPARATE))).toBeNull();
});

test('a harness thread whose sessions cannot move still names its proofs, offering no move', () => {
  const recorded = row('cursor', 'terminal', 'idle', 'running', SEPARATE);
  if (recorded.harness === null) throw new Error('harness row expected');
  const capabilities = { ...recorded.harness.capabilities, history: 'session', copies: { whole: 'record', point: 'record' } } as const;
  expect(transportOffer({ ...recorded, harness: { ...recorded.harness, capabilities } })).toMatchObject({ to: null });
});

test('a Tagma agent a CLI hosts offers one direct move into that CLI, and no other thread of Tagma offers any', () => {
  expect(transportOffer(native('idle'))).toMatchObject({ to: 'terminal', direct: true, turning: false });
  expect(transportOffer({ ...native('idle'), cli: null })).toBeNull();
});
