import type { ModelSpec, ModelSwitch } from '@runlith/llm/models/description';
import type { CatalogModels, ProviderCatalogReader } from '@runlith/tagma/adapter/provider';
import { Clock, Effect, Schema } from 'effect';
import { credentialSchema } from './accounts';
import { CursorRefused, cursorGet } from './http';
import { contextModelId } from './selection';

const parameterValue = Schema.Struct({ id: Schema.String, value: Schema.String });
const modelSchema = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1)),
  displayName: Schema.String,
  aliases: Schema.optional(Schema.Array(Schema.String)),
  parameters: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        displayName: Schema.optional(Schema.String),
        values: Schema.Array(Schema.Struct({ value: Schema.String, displayName: Schema.optional(Schema.String) })),
      }),
    ),
  ),
  variants: Schema.optional(
    Schema.Array(
      Schema.Struct({
        params: Schema.Array(parameterValue),
        displayName: Schema.String,
        isDefault: Schema.optional(Schema.Boolean),
        isMaxMode: Schema.optional(Schema.Boolean),
      }),
    ),
  ),
});
const responseSchema = Schema.Struct({ items: Schema.Array(modelSchema) });

const CONTEXTS: Readonly<Record<string, number>> = {
  'composer-2.5': 200_000,
  'claude-sonnet-5-5': 200_000,
  'gpt-5.6-sol': 272_000,
  'grok-4.7': 256_000,
};

const contextSize = (value: string): number | undefined => {
  const match = /^(\d+(?:\.\d+)?)\s*([km])?$/iu.exec(value);
  if (match === null) return undefined;
  const size = Number(match[1]) * (match[2]?.toLowerCase() === 'm' ? 1_000_000 : match[2]?.toLowerCase() === 'k' ? 1_000 : 1);
  return Number.isSafeInteger(size) && size > 0 ? size : undefined;
};

export const projectCatalog = Effect.fnUntraced(function* (body: unknown): Effect.fn.Return<CatalogModels, CursorRefused> {
  const response = yield* Schema.decodeUnknownEffect(responseSchema)(body).pipe(
    Effect.mapError((cause) => new CursorRefused({ message: cause.message })),
  );
  const models: Record<string, ModelSpec> = {};
  const warnings: string[] = [];
  for (const model of response.items) {
    const parameters = model.parameters ?? [];
    const defaults = new Map(model.variants?.find((variant) => variant.isDefault)?.params.map(({ id, value }) => [id, value]));
    const context = parameters.find(({ id }) => id === 'context');
    const reasoning = parameters.find(({ id }) => id === 'reasoning');
    const switches: ModelSwitch[] = parameters
      .filter(({ id }) => id !== 'context' && id !== 'reasoning')
      .map((parameter) => ({
        id: parameter.id,
        label: parameter.displayName ?? parameter.id,
        description: '',
        values: parameter.values.map(({ value, displayName }) => ({ id: value, label: displayName ?? value })),
        default: defaults.get(parameter.id) ?? null,
      }));
    if (model.variants?.some((variant) => variant.isMaxMode))
      switches.push({
        id: 'maxMode',
        label: 'Max mode',
        description: '',
        values: [
          { id: 'false', label: 'Off' },
          { id: 'true', label: 'On' },
        ],
        default: model.variants.find((variant) => variant.isDefault)?.isMaxMode === true ? 'true' : 'false',
      });
    const contexts =
      context === undefined
        ? [undefined]
        : context.values
            .map(({ value }) => value)
            .sort((left, right) => Number(right === defaults.get('context')) - Number(left === defaults.get('context')));
    for (const value of contexts) {
      const capacity = value === undefined ? CONTEXTS[model.id] : contextSize(value);
      if (capacity === undefined) {
        warnings.push(`${model.displayName}${value === undefined ? '' : ` (${value})`}: context window is unknown`);
        continue;
      }
      const id = value === undefined ? model.id : contextModelId(model.id, value);
      models[id] = {
        label: value === undefined ? model.displayName : `${model.displayName} · ${value}`,
        capacity: { context: capacity },
        capabilities: ['text', 'vision'],
        reasoning: reasoning?.values.map(({ value }) => value) ?? [],
        defaultReasoning: defaults.get('reasoning') ?? null,
        switches,
        servedAs: model.id,
        aliases: value === undefined || value === (defaults.get('context') ?? contexts[0]) ? [model.id, ...(model.aliases ?? [])] : [],
      };
    }
  }
  const ids = Object.keys(models);
  return { models, defaultTextModel: ids.find((id) => /^(?:composer|grok)/u.test(id)) ?? ids[0] ?? '', warnings };
});

export const catalog: ProviderCatalogReader = {
  read: Effect.fn('cursor.catalog')(function* (credentials, ownerId, account) {
    const stored = yield* Effect.tryPromise({
      try: () => credentials.credential(ownerId, 'cursor', account),
      catch: (cause) => new CursorRefused({ message: String(cause) }),
    });
    const credential = yield* Schema.decodeUnknownEffect(credentialSchema)(stored).pipe(
      Effect.mapError((cause) => new CursorRefused({ message: cause.message })),
    );
    if (credential.expiresAt !== null && credential.expiresAt <= (yield* Clock.currentTimeMillis))
      return yield* new CursorRefused({ message: 'The Cursor key expired. Sign in again.' });
    const body = yield* cursorGet('models', credential.accessToken);
    return yield* projectCatalog(body);
  }),
};
