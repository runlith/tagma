import { expect, test } from 'bun:test';
import { Result } from 'effect';
import { decodeThreadEventPayloadResult } from '@runlith/agent/thread/persisted';
import { ENTRY_KINDS } from '../composed.js';

const before = [
  'claim_task',
  'release_task',
  'ready_tasks',
  'enforce_rule',
  'set_law_enabled',
  'check_law',
  'set_law_delivery',
  'look',
  'plugin.own',
];
const after = [
  'claim_block',
  'release_block',
  'ready_work',
  'enforce_rule',
  'set_rule_enabled',
  'check_rules',
  'set_rule_delivery',
  'look',
  'plugin.own',
];

test('restored context evidence names current operation IDs and keeps the original instructions', () => {
  const payload = {
    contextChange: {
      requestId: 'request',
      runId: 'run',
      sourceKey: 'scope',
      fromGeneration: 0,
      outcome: 'published',
      requestedAt: '2026-10-12T00:00:00.000Z',
      record: { generation: 1, sourceKey: 'scope', requestId: 'request' },
      evidence: { tools: before, instructions: 'claim_task was written into this frozen prompt', profileId: null, approvalMode: 'review' },
    },
  };
  const read = decodeThreadEventPayloadResult(ENTRY_KINDS, payload);
  if (Result.isFailure(read)) throw read.failure;
  const evidence = read.success.contextChange?.evidence;
  if (evidence === undefined) throw new Error('the published context has no evidence');
  expect(evidence.tools).toEqual(after);
  expect(evidence.instructions).toBe(payload.contextChange.evidence.instructions);
  expect(payload.contextChange.evidence.tools).toEqual(before);
  const again = decodeThreadEventPayloadResult(ENTRY_KINDS, read.success);
  if (Result.isFailure(again)) throw again.failure;
  expect(again.success).toEqual(read.success);
});
