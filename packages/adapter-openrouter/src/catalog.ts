import type { ModelSpec } from '@runlith/llm/models/description';
import type { CatalogModels, ProviderCatalogReader } from '@runlith/tagma/adapter/provider';
import { Data, Effect, Schema } from 'effect';
import { HttpClient, HttpClientRequest } from 'effect/http';

export const OPENROUTER_PROVIDER = 'openrouter';

export const OPENROUTER_API = 'https://openrouter.ai/api';

class CatalogUnread extends Data.TaggedError('CatalogUnread')<{ readonly message: string }> {}

const Listing = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String.check(Schema.isMinLength(1)),
      name: Schema.optional(Schema.String),
      context_length: Schema.optional(Schema.NullOr(Schema.Number)),
    }),
  ),
});

export const projectCatalog = (body: unknown): Effect.Effect<CatalogModels, CatalogUnread> =>
  Schema.decodeUnknownEffect(Listing)(body).pipe(
    Effect.mapError((issue) => new CatalogUnread({ message: issue.message })),
    Effect.map((listing) => ({
      models: Object.fromEntries(
        listing.data.map((model): [string, ModelSpec] => [
          model.id,
          {
            label: model.name ?? model.id,
            ...(typeof model.context_length === 'number' && model.context_length > 0
              ? { capacity: { context: model.context_length } }
              : {}),
            capabilities: ['decision'],
            reasoning: [],
            defaultReasoning: null,
          },
        ]),
      ),
      defaultTextModel: '',
    })),
  );

export const catalog: ProviderCatalogReader = {
  read: Effect.fn('openrouter.catalog')(
    function* (credentials, ownerId, account) {
      const key = yield* Effect.tryPromise({
        try: () => credentials.apiKey(ownerId, OPENROUTER_PROVIDER, account),
        catch: (cause) => new CatalogUnread({ message: cause instanceof Error ? cause.message : String(cause) }),
      });
      const client = yield* HttpClient.HttpClient;
      const response = yield* client.execute(
        HttpClientRequest.get(`${OPENROUTER_API}/v1/models?output_modalities=decisions`).pipe(HttpClientRequest.bearerToken(key)),
      );
      if (response.status < 200 || response.status >= 300)
        return yield* new CatalogUnread({ message: `OpenRouter answered ${response.status}: ${yield* response.text}` });
      return yield* projectCatalog(yield* response.json);
    },
    Effect.mapError((cause) => (cause instanceof CatalogUnread ? cause : new CatalogUnread({ message: cause.message }))),
  ),
};
