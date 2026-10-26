import type { CatalogOperationId, OPERATIONS, OperationAnswer, OperationInput } from '@tagma/server/composition/catalog';
import { knownAnswer } from '@tagma/server/platform/contract/wire/operation';
import { toJson } from '@runlith/utils/json';
import { Effect, Schema } from 'effect';

type Declared = typeof OPERATIONS;

type Codecs = { readonly params: Schema.Codec<unknown, unknown>; readonly answer?: Schema.Codec<unknown, unknown> };

let declared: Declared | null = null;
let loading: Promise<Declared> | null = null;

export const loadedOperations = (): Declared | null => declared;

export const loadOperations = (): Promise<Declared> =>
  (loading ??= import('@tagma/server/composition/catalog').then(
    (catalog) => (declared = catalog.OPERATIONS),
    (failure: unknown) => {
      loading = null;
      throw failure;
    },
  ));

const codecsOf = (id: CatalogOperationId): Effect.Effect<Codecs> =>
  declared === null ? Effect.map(Effect.promise(loadOperations), (loaded) => loaded[id]) : Effect.succeed(declared[id]);

export const operationPayload = <Id extends CatalogOperationId>(
  id: Id,
  input: OperationInput<Id>,
): Effect.Effect<unknown, Schema.SchemaError> =>
  Effect.flatMap(codecsOf(id), (codecs) => Effect.map(Schema.encodeUnknownEffect(codecs.params)(input), toJson));

const jsonAnswers = new Map<CatalogOperationId, (answered: unknown) => Effect.Effect<unknown, Schema.SchemaError>>();

const jsonAnswerOf = (id: CatalogOperationId): Effect.Effect<(answered: unknown) => Effect.Effect<unknown, Schema.SchemaError>> => {
  const held = jsonAnswers.get(id);
  if (held !== undefined) return Effect.succeed(held);
  return Effect.map(codecsOf(id), (codecs) => {
    const answer = codecs.answer;
    const decode = answer === undefined ? Effect.succeed : Schema.decodeUnknownEffect(Schema.toCodecJson(knownAnswer(answer)));
    jsonAnswers.set(id, decode);
    return decode;
  });
};

export const operationAnswer = <Id extends CatalogOperationId>(
  id: Id,
  answered: unknown,
): Effect.Effect<OperationAnswer<Id>, Schema.SchemaError> =>
  Effect.flatMap(jsonAnswerOf(id), (decode) => decode(answered)) as Effect.Effect<OperationAnswer<Id>, Schema.SchemaError>;
