import type { ModelRequester } from '@runlith/agent/modelPort';
import type { CompactionModels } from '@runlith/agent/thread/compaction/CompactionModels';
import type { AccountKey } from '@runlith/llm/models/authStatus';
import type { LLMError } from '@runlith/llm/schema/errors';
import { Context, type Effect } from 'effect';

export class ModelAccess extends Context.Service<ModelAccess, ModelRequester & CompactionModels>()('tagma/providers/ModelAccess') {}

export class AccountCredentials extends Context.Service<
  AccountCredentials,
  {
    account(provider: string, selected?: string): Effect.Effect<AccountKey, LLMError>;
  }
>()('tagma/providers/AccountCredentials') {}
