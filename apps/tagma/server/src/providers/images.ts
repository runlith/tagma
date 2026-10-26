import { AccountKey } from '@runlith/llm/models/authStatus';
import type { ModelClient } from '@runlith/llm/models/client';
import { pickerOrder } from '@runlith/llm/models/description';
import { InvalidRequestReason, LLMError } from '@runlith/llm/schema/errors';
import { Clock, Effect } from 'effect';
import { Headers } from 'effect/http';
import { DefaultAccounts, ProviderAccounts } from './contract/service/accounts.js';
import { ProviderCredentials } from './contract/service/credentials.js';
import { type ImageModel, ImageModels } from './contract/service/images.js';
import { AccountQuota } from './contract/service/quota.js';
import { ProviderRegistry } from './contract/service/registry.js';
import { makeOperatorCredentials } from './credentials/operator.js';

const unserved = (provider: string, model: string): LLMError =>
  new LLMError({ module: 'Images', method: 'draw', reason: new InvalidRequestReason({ message: `${provider} draws no ${model}.` }) });

export const makeImageModels = Effect.fnUntraced(function* (client: ModelClient) {
  const registry = yield* ProviderRegistry;
  const { forCatalog, keys } = yield* ProviderCredentials;
  const { defaultAccount } = yield* DefaultAccounts;
  const accounts = yield* ProviderAccounts;
  const quota = yield* AccountQuota;

  const declared = (): readonly ImageModel[] =>
    pickerOrder([registry.current().wires.providers]).flatMap((provider) =>
      Object.entries(provider.imageModels ?? {}).map(([model, spec]) => ({
        provider: provider.id,
        providerLabel: provider.label,
        model,
        spec,
      })),
    );

  return ImageModels.of({
    declared,
    signed: Effect.fn('ImageModels.signed')(function* () {
      const { providers } = yield* accounts.connected;
      return declared().filter((model) => providers.has(model.provider));
    }),
    draw: Effect.fn('ImageModels.draw')(function* (call, request) {
      const catalog = registry.current();
      const provider = yield* registry.callable(call.provider);
      const spec = provider.imageModels?.[call.model];
      if (provider.kind !== 'wire' || provider.images === undefined || spec === undefined)
        return yield* unserved(call.provider, call.model);
      const profile = provider.images;
      const credentials = makeOperatorCredentials({ tokens: forCatalog(catalog), defaultAccount, keys });
      const observed = Effect.fnUntraced(function* (headers: Headers.Headers) {
        const account = credentials.selectedAccount;
        const observation = profile.quota(headers, new Date(yield* Clock.currentTimeMillis));
        if (observation !== null && account !== undefined) yield* quota.merge(provider.id, AccountKey.make(account), observation);
      });
      const answer = yield* profile.generate({ ownerId: call.ownerId, model: call.model, credentials }, request).pipe(
        Effect.provideContext(client),
        Effect.tapError((failure) => {
          const replied = 'http' in failure.reason ? failure.reason.http?.response?.headers : undefined;
          return replied === undefined ? Effect.void : observed(Headers.fromInput(replied));
        }),
      );
      yield* observed(answer.headers);
      return { ...answer, account: credentials.selectedAccount ?? null };
    }),
  });
});
