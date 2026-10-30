import { Context, type Effect } from 'effect';
import type { HarnessDecision, HarnessAnswer } from '../wire/call.js';
import type { HarnessCall } from '@runlith/tagma/adapter/harness';
import type { HarnessFailure } from '../../../threads/contract/service/failure.js';
import type { HarnessName } from '../../../threads/contract/wire/harness/names.js';

export type HarnessVerdict =
  | { readonly _tag: 'Unspoken' }
  | {
      readonly _tag: 'Asks';
      readonly ruleId: string;
      readonly reason: string | null;
      readonly asked: readonly string[];
    }
  | { readonly _tag: 'Denies'; readonly ruleId: string; readonly reason: string };

export type HarnessJudging = {
  verdict(threadId: string, call: HarnessCall, mutating?: boolean): Effect.Effect<HarnessVerdict, HarnessFailure>;
  prompt(name: HarnessName, call: HarnessCall): string;
};

export class HarnessPermissions extends Context.Service<
  HarnessPermissions,
  HarnessJudging & {
    judge(threadId: string, call: HarnessCall): Effect.Effect<HarnessDecision, HarnessFailure>;
    outcome(threadId: string, requestId: string, withinMs: number): Effect.Effect<HarnessAnswer, HarnessFailure>;
    ended(threadId: string, callId: string): Effect.Effect<void, HarnessFailure>;
  }
>()('tagma/external-harnesses/HarnessPermissions') {}
