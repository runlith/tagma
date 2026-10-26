import type { GrantRevocation } from '../contract/service/grants.js';
import type { CancellationCause } from '@runlith/executions/protocol/call';
import type { ExecutionRef, ExecutionState, Incarnation } from '@runlith/executions/protocol/execution';
import type { StopAction, StopReceipt } from '@runlith/executions/protocol/stop';
import type { TerminalOperationKey } from '../contract/wire/requestKeys.js';
import type { TerminalRecord } from '../contract/wire/terminals.js';

export const GENERATION_ENDED = 'generation-ended' as const;
export type GenerationEndedReason = typeof GENERATION_ENDED;

export const isReplacedGeneration = (incarnation: number, generation: number): boolean => incarnation < generation;

export const generationEndedReason = (incarnation: number, generation: number | null): GenerationEndedReason | undefined =>
  generation === null || incarnation >= generation ? undefined : GENERATION_ENDED;

export const storeReasonOfRevocation = (cause: GrantRevocation): GenerationEndedReason | undefined =>
  cause === 'custodian-replaced' ? GENERATION_ENDED : undefined;

export const lostState = (record: TerminalRecord, generation: Incarnation | null): ExecutionState | undefined =>
  generation === null || record.execution.incarnation >= generation
    ? undefined
    : {
        ref: record.execution,
        transport: record.transport,
        lifetime: record.lifetime,
        purpose: 'command',
        phase: 'ended',
        streams: { stdout: 'error', stderr: 'error', pty: 'error' },
        cleanup: 'unverifiable',
        record: 'gapped',
      };

export const replacedReceipt = (
  execution: ExecutionRef,
  key: TerminalOperationKey,
  cause: CancellationCause,
  action: StopAction,
): StopReceipt => ({
  execution,
  operation: { installation: execution.installation, operation: key.operationId },
  requested: action,
  cause,
  steps: [],
  coverage: [],
  relation: 'unknown',
  confirmed: [],
  residual: [],
  unverifiable: [
    {
      kind: 'process',
      detail: `execution ${execution.execution} at generation ${execution.incarnation}`,
      reason: 'the host that ran it has been replaced, so nothing can ever measure how it ended',
    },
  ],
  streams: [],
  cleanup: 'unverifiable',
  retention: 'lost',
  abandonedOutput: false,
  cost: {
    _tag: 'Unmeasured',
    reason: 'unknown',
    detail: 'the generation that held this execution was replaced',
  },
});
