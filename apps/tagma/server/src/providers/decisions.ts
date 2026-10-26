import { DecisionRefused } from '@runlith/llm/decision';
import type { ModelClient } from '@runlith/llm/models/client';
import { Effect } from 'effect';
import { DefaultAccounts } from './contract/service/accounts.js';
import { ProviderCredentials } from './contract/service/credentials.js';
import { DecisionModels } from './contract/service/decisions.js';
import { ProviderRegistry } from './contract/service/registry.js';
import { makeOperatorCredentials } from './credentials/operator.js';

export const makeDecisionModels = Effect.fnUntraced(function* (client: ModelClient) {
  const registry = yield* ProviderRegistry;
  const { forCatalog, keys } = yield* ProviderCredentials;
  const { defaultAccount } = yield* DefaultAccounts;

  return DecisionModels.of({
    decide: Effect.fn('DecisionModels.decide')(function* (call, request) {
      const catalog = registry.current();
      const provider = yield* registry
        .callable(call.provider)
        .pipe(Effect.mapError((refused) => new DecisionRefused({ reason: 'no-model', message: refused.reason })));
      const served = catalog.models.modelsFor(call.provider, 'decision').some((row) => row.id === call.model);
      if (provider.kind !== 'wire' || provider.decisions === undefined || !served)
        return yield* new DecisionRefused({ reason: 'no-model', message: `${call.provider} answers no decisions on ${call.model}` });
      const credentials = makeOperatorCredentials({ tokens: forCatalog(catalog), defaultAccount, keys });
      return yield* provider.decisions
        .decide({ ownerId: call.ownerId, model: call.model, account: call.account ?? undefined, credentials }, request)
        .pipe(Effect.provideContext(client));
    }),
  });
});
