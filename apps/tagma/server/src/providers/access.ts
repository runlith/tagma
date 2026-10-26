import { modelRequester, refusedModelRequest } from '@runlith/agent/ModelRequests';
import { type ModelClient, openModelClient } from '@runlith/llm/models/client';
import { AdapterFailedReason, LLMError } from '@runlith/llm/schema/errors';
import { ProviderID } from '@runlith/llm/schema/ids';
import type { TokenStore } from '@runlith/llm/oauth/FileTokenStore';
import { ThreadModelNotServed } from '@runlith/agent/thread/compaction/CompactionModels';
import { Effect, Layer } from 'effect';
import type { DefaultAccounts } from './contract/service/accounts.js';
import { AccountCredentials, ModelAccess } from './contract/service/access.js';
import type { ProviderCatalog, ProviderRegistry } from './contract/service/registry.js';
import type { ConsoleKeyStore } from './credentials/consoleKeys.js';
import { makeOperatorCredentials } from './credentials/operator.js';

export const modelAccess = (
  registry: ProviderRegistry['Service'],
  tokens: (catalog: ProviderCatalog) => TokenStore,
  defaultAccount: DefaultAccounts['Service']['defaultAccount'],
  client: ModelClient,
  keys?: ConsoleKeyStore,
): ModelAccess['Service'] => ({
  request: (input) => {
    const catalog = input.runId === undefined ? registry.current() : registry.forRun(input.runId);
    const { wires, failures } = catalog;
    const failure = failures.get(input.provider);
    if (failure !== undefined)
      return refusedModelRequest(
        new LLMError({
          module: 'LLM',
          method: 'request',
          reason: new AdapterFailedReason({ provider: ProviderID.make(input.provider), detail: failure }),
        }),
        { provider: input.provider, model: input.model ?? null, rung: input.reasoning ?? null },
      );
    const credentials = makeOperatorCredentials({
      tokens: tokens(catalog),
      defaultAccount: (provider, unit) => defaultAccount(provider, unit, input.runId),
      keys,
    });
    const request = modelRequester(wires, credentials, client).request(input);
    return { ...request, signedAccount: () => credentials.selectedAccount };
  },
  served: (provider, model, runId) => {
    const { models } = runId === undefined ? registry.current() : registry.forRun(runId);
    const id = model ?? (models.registered(provider) ? models.defaultTextModelId(provider) : null);
    const option = id === null ? undefined : models.modelsFor(provider, 'text').find((row) => row.id === id);
    if (option?.capacity === undefined) return Effect.fail(new ThreadModelNotServed({ provider, model: model ?? null }));
    return Effect.succeed({
      id: option.id,
      capacity: option.capacity,
      cacheLifetime: option.cacheLifetime,
      requestLimits: option.requestLimits,
      compactionTrigger: option.compactionTrigger,
    });
  },
  defaultModel: (provider, runId) => {
    const { models } = runId === undefined ? registry.current() : registry.forRun(runId);
    return models.registered(provider) ? models.defaultTextModelId(provider) : null;
  },
});

export const modelAccessLayer = (
  registry: ProviderRegistry['Service'],
  tokens: (catalog: ProviderCatalog) => TokenStore,
  defaultAccount: DefaultAccounts['Service']['defaultAccount'],
  keys?: ConsoleKeyStore,
): Layer.Layer<ModelAccess> =>
  Layer.effect(
    ModelAccess,
    Effect.map(openModelClient(), (client) => modelAccess(registry, tokens, defaultAccount, client, keys)),
  );

export const accountCredentialsLayer = (
  tokens: TokenStore,
  defaultAccount: DefaultAccounts['Service']['defaultAccount'],
  keys?: ConsoleKeyStore,
): Layer.Layer<AccountCredentials> =>
  Layer.succeed(AccountCredentials, {
    account: (provider, selected) => makeOperatorCredentials({ tokens, defaultAccount, keys }).accountKey(provider, selected),
  });
