import { Context, type Effect, type Stream } from 'effect';
import type { CallAddress, CallControl, CallControlResult, CallEvent, CallRecord } from '@runlith/agent/callProgress';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { GateRefusal, RefusalBody } from '../../../platform/contract/wire/refusal.js';

export type CallScope = {
  readonly projectId: number;
  readonly threadId?: string;
};

export class CallActivity extends Context.Service<
  CallActivity,
  {
    snapshot(scope: CallScope, ended: number): Effect.Effect<readonly CallRecord[], StoreFailure>;
    held(scope: CallScope): Effect.Effect<readonly CallRecord[], StoreFailure>;
    feed(scope: CallScope, ended: number): Stream.Stream<CallEvent, RefusalBody>;
    control(
      scope: CallScope,
      address: CallAddress,
      control: CallControl,
    ): Effect.Effect<CallControlResult, GateRefusal<'unknown-invocation'> | StoreFailure>;
    settled(
      scope: CallScope,
      address: CallAddress,
      waitMs: number,
    ): Effect.Effect<CallRecord | null, GateRefusal<'unknown-invocation'> | StoreFailure>;
  }
>()('tagma/native-harness/CallActivity') {}
