import { Data } from 'effect';
import { Incarnation } from '@runlith/executions/protocol/execution';
import type { Refusal as HostRefusal } from '@runlith/executions/protocol/host';
import type { TerminalRecord } from './terminals.js';

export const REFUSAL_CODES = {
  'not-holder': 'terminal-not-holder',
  'foreign-project': 'terminal-foreign-project',
  ineligible: 'terminal-ineligible',
  destination: 'terminal-destination',
  'no-grant': 'terminal-no-grant',
  'no-binding': 'terminal-no-binding',
  stale: 'terminal-stale',
  'operation-conflict': 'terminal-operation-conflict',
  'operation-expired': 'terminal-operation-expired',
  'operation-capacity': 'terminal-operation-capacity',
  capacity: 'terminal-capacity',
  memory: 'terminal-memory',
  'host-state': 'terminal-host-state',
  'host-incompatible': 'terminal-host-incompatible',
  ceiling: 'terminal-ceiling',
  'service-denied': 'terminal-service-denied',
  'stale-authority': 'terminal-stale-authority',
  unrelated: 'terminal-unrelated',
  'no-command': 'terminal-no-command',
  'no-owner': 'terminal-no-owner',
  'operator-only': 'terminal-operator-only',
  'selection-changed': 'terminal-selection-changed',
  'record-lost': 'terminal-record-lost',
} as const;

export type TerminalRefusalReason = keyof typeof REFUSAL_CODES;

export class TerminalRefused extends Data.TaggedError('TerminalRefused')<{
  readonly reason: TerminalRefusalReason;
  readonly message: string;
}> {}

export type TerminalRefusalCode = (typeof REFUSAL_CODES)[TerminalRefusalReason];

export const TERMINAL_REFUSALS: readonly TerminalRefusalCode[] = Object.values(REFUSAL_CODES);

export const hostRefusalReason: Record<HostRefusal['_tag'], TerminalRefused['reason']> = {
  CapacityExceeded: 'capacity',
  MemoryExhausted: 'memory',
  OperationConflict: 'operation-conflict',
  InputFenced: 'stale',
  InputYielding: 'host-state',
  InputProfileConflict: 'stale',
  InterpretationUnavailable: 'host-state',
  IncarnationMismatch: 'stale',
  CustodyConflict: 'stale',
  Unauthorized: 'ineligible',
  UnsupportedCapability: 'ineligible',
  UnknownExecution: 'ineligible',
  AdmissionClosed: 'host-state',
  HostUnavailable: 'host-state',
  HostConflict: 'host-state',
  HostIncompatible: 'host-incompatible',
  SpawnFailed: 'host-state',
  HolderLost: 'host-state',
  StreamMissing: 'ineligible',
};

export const hostRefusalOf = {
  'not-holder': 'Unauthorized',
  'foreign-project': 'Unauthorized',
  ineligible: 'Unauthorized',
  destination: 'Unauthorized',
  'no-grant': 'InputFenced',
  'no-binding': 'Unauthorized',
  stale: 'InputFenced',
  'operation-conflict': 'OperationConflict',
  'operation-expired': 'OperationConflict',
  'operation-capacity': 'CapacityExceeded',
  capacity: 'CapacityExceeded',
  memory: 'MemoryExhausted',
  'host-state': 'HostUnavailable',
  'host-incompatible': 'HostIncompatible',
  ceiling: 'Unauthorized',
  'service-denied': 'Unauthorized',
  'stale-authority': 'InputFenced',
  unrelated: 'Unauthorized',
  'no-command': 'UnknownExecution',
  'no-owner': 'Unauthorized',
  'operator-only': 'Unauthorized',
  'selection-changed': 'Unauthorized',
  'record-lost': 'UnknownExecution',
} as const satisfies Record<TerminalRefused['reason'], HostRefusal['_tag']>;

const HOST_QUOTE = 240;

export const hostSentence = (refusal: HostRefusal): string => {
  const first = refusal.reason.split('\n')[0] ?? '';
  return first.length > HOST_QUOTE ? `${first.slice(0, HOST_QUOTE)}…` : first;
};

export class TerminalUnavailable extends Data.TaggedError('TerminalUnavailable')<{
  readonly owner: 'store' | 'host' | 'registry' | 'environment';
  readonly message: string;
}> {}

export const staleIncarnation = (record: TerminalRecord, current: Incarnation): boolean => record.execution.incarnation !== current;
