import type { ModelRequester } from '@runlith/agent/modelPort';
import type { CompactionModels } from '@runlith/agent/thread/compaction/CompactionModels';
import type { DecisionAnswer, DecisionRefused, DecisionRequest } from '@runlith/llm/decision';
import type { AccountKey } from '@runlith/llm/models/authStatus';
import type { LLMError } from '@runlith/llm/schema/errors';
import { Context, type Effect } from 'effect';

export type DecisionCall = {
  readonly provider: string;
  readonly model: string;
  readonly account: string | null;
  readonly ownerId: string;
};

export type DecisionProfiles = {
  decide(call: DecisionCall, request: DecisionRequest): Effect.Effect<DecisionAnswer, DecisionRefused>;
};

export class ModelAccess extends Context.Service<ModelAccess, ModelRequester & CompactionModels & DecisionProfiles>()(
  'tagma/providers/ModelAccess',
) {}

export class AccountCredentials extends Context.Service<
  AccountCredentials,
  {
    account(provider: string, selected?: string): Effect.Effect<AccountKey, LLMError>;
  }
>()('tagma/providers/AccountCredentials') {}
