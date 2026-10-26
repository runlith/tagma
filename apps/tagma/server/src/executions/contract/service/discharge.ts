import { Context, type Effect } from 'effect';
import type { ExecutionRef, HostRequestRef } from '@runlith/executions/protocol/execution';
import type { EndingReading } from '@runlith/executions/protocol/stop';
import type { RetireAnswer } from '@runlith/executions/protocol/wire';
import type { TerminalFailure } from './terminals.js';

export type TerminalDischarge =
  | { readonly _tag: 'Discharged' }
  | {
      readonly _tag: 'Retained';
      readonly reason:
        | 'unended'
        | 'foreign-reference'
        | 'incomplete-cleanup'
        | 'residual'
        | 'unmeasured'
        | 'unresolved-operation'
        | 'not-replaced'
        | 'unreadable-generation';
    };

export type Dischargers = {
  readonly ended: (projectId: number, execution: ExecutionRef, remeasure?: boolean) => Effect.Effect<TerminalDischarge, TerminalFailure>;
  readonly discharge: (
    projectId: number,
    execution: ExecutionRef,
    receipt: EndingReading,
  ) => Effect.Effect<TerminalDischarge, TerminalFailure>;
  readonly dischargeReplaced: (projectId: number, execution: ExecutionRef) => Effect.Effect<TerminalDischarge, TerminalFailure>;
  readonly sweepReplaced: () => Effect.Effect<{
    readonly discharged: number;
    readonly retained: ReadonlyMap<string, number>;
  }>;
  readonly retire: (projectId: number, operation: HostRequestRef, execution: ExecutionRef) => Effect.Effect<RetireAnswer, TerminalFailure>;
  readonly disposition: () => Effect.Effect<{
    readonly stamped: number;
    readonly discharged: number;
    readonly retained: ReadonlyMap<string, number>;
  }>;
};

export class Discharge extends Context.Service<Discharge, Dischargers>()('tagma/executions/Discharge') {}
