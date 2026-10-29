import { Context, type Effect, type Exit } from 'effect';
import type { CallRecord } from '@runlith/agent/callProgress';
import type { AgentThreadRef, PendingRuntimeGuide } from '@runlith/agent/contracts';
import type { StoreFailure } from '../../../platform/contract/service/store.js';

export type CallEnding =
  | {
      readonly outcome: 'completed' | 'failed' | 'stopped';
      readonly result: string;
      readonly threads?: readonly AgentThreadRef[];
      readonly guides?: readonly PendingRuntimeGuide[];
    }
  | { readonly outcome: 'interrupted' }
  | { readonly outcome: 'elsewhere' };

export type OwedScope = { readonly projectId?: number; readonly threadId?: string };

export type DetachedCall = {
  readonly threadId: string | null;
  readonly runId: string | null;
  readonly name: string;
  readonly input: unknown;
};

export class CallEpoch extends Context.Service<CallEpoch, { readonly id: string }>()('tagma/threads/CallEpoch') {}

export class OwedCalls extends Context.Service<
  OwedCalls,
  {
    readonly owe: (call: CallRecord) => Effect.Effect<void, StoreFailure>;
    readonly began: (call: CallRecord) => Effect.Effect<void, StoreFailure>;
    readonly end: (call: CallRecord, ending: CallEnding) => Effect.Effect<void, StoreFailure>;
    readonly owed: (scope: OwedScope) => Effect.Effect<readonly CallRecord[], StoreFailure>;
    readonly detached: <A, E>(
      call: DetachedCall,
      work: Effect.Effect<A, E>,
      stopped: (reason: string) => A,
      ending: (exit: Exit.Exit<A, E>, stopping: boolean) => CallEnding,
    ) => Effect.Effect<unknown, E>;
  }
>()('tagma/threads/OwedCalls') {}
