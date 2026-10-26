import { expect, test } from 'bun:test';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { TerminalOperationKey } from '../contract/wire/requestKeys.js';
import type { TerminalRecord } from '../contract/wire/terminals.js';
import {
  GENERATION_ENDED,
  generationEndedReason,
  isReplacedGeneration,
  lostState,
  replacedReceipt,
  storeReasonOfRevocation,
} from './generationEnded.js';

test('the ended reason is the generation-ended token', () => {
  expect(GENERATION_ENDED).toBe('generation-ended');
});

test('an incarnation below the host generation ended with the generation; one at it did not', () => {
  expect(isReplacedGeneration(3, 4)).toBe(true);
  expect(isReplacedGeneration(4, 4)).toBe(false);
  expect(generationEndedReason(3, 4)).toBe('generation-ended');
  expect(generationEndedReason(4, 4)).toBeUndefined();
  expect(generationEndedReason(5, 4)).toBeUndefined();
  expect(generationEndedReason(3, null)).toBeUndefined();
});

test('only a replaced custodian records a generation-ended reason; a host-retired ending records none', () => {
  expect(storeReasonOfRevocation('custodian-replaced')).toBe('generation-ended');
  expect(storeReasonOfRevocation('execution-ended')).toBeUndefined();
  expect(storeReasonOfRevocation('run-ended')).toBeUndefined();
  expect(storeReasonOfRevocation('view-closed')).toBeUndefined();
  expect(storeReasonOfRevocation('binding-closed')).toBeUndefined();
  expect(storeReasonOfRevocation('custody-transferred')).toBeUndefined();
  expect(storeReasonOfRevocation('permission-withdrawn')).toBeUndefined();
});

const executionAt = (incarnation: number): ExecutionRef =>
  ({ installation: 'i', execution: 'exec-1', incarnation }) as unknown as ExecutionRef;

const recordAt = (incarnation: number): TerminalRecord =>
  ({ execution: executionAt(incarnation), transport: 'pty', lifetime: 'held' }) as unknown as TerminalRecord;

test('a record of a replaced generation ends without inventing its exit, and its bytes stay readable by key', () => {
  const state = lostState(recordAt(3), 4);

  expect(state?.phase).toBe('ended');
  expect(state !== undefined && 'nativeExit' in state).toBe(false);
  expect(state?.cleanup).toBe('unverifiable');
  expect(state?.record).toBe('gapped');
  expect(state?.streams).toEqual({ stdout: 'error', stderr: 'error', pty: 'error' });
});

test('a record at the host generation is nothing lost; without a generation nothing is derived', () => {
  expect(lostState(recordAt(4), 4)).toBeUndefined();
  expect(lostState(recordAt(3), null)).toBeUndefined();
});

test('a stop receipt for a replaced generation proves nothing about how the process ended', () => {
  const key = {
    projectId: 5,
    operationId: 'op-1',
    requester: 'operator',
    mutation: 'stop',
    targetKey: 'k',
  } as unknown as TerminalOperationKey;
  const receipt = replacedReceipt(executionAt(3), key, 'explicit-stop', 'signal');

  expect('nativeExit' in receipt).toBe(false);
  expect(receipt.cleanup).toBe('unverifiable');
  expect(receipt.retention).toBe('lost');
  expect(receipt.confirmed).toEqual([]);
  expect(receipt.coverage).toEqual([]);
  expect(receipt.unverifiable.length).toBeGreaterThan(0);
});
