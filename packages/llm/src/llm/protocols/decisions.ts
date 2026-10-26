import { Effect, Schema } from 'effect';
import type { HttpClientResponse } from 'effect/http';
import {
  type DecisionAnswer,
  type DecisionContent,
  type DecisionQuestion,
  type DecisionRequest,
  type DecisionVerdict,
  DecisionRefused,
  providerRefusal,
} from '../decision';
import * as Auth from '../route/auth';
import { HttpExecutor } from '../route/executor';
import { Usage } from '../schema/events';
import { ModelID, ProviderID } from '../schema/ids';
import { ModelIdentity } from '../schema/options';
import { namedHeaders } from '../utils/headers';
import * as ProviderShared from './shared';

export type DecisionsRoute = {
  readonly provider: string;
  readonly url: string;
  readonly auth: Auth.Auth;
};

const Probabilities = Schema.optional(Schema.Record(Schema.String, Schema.Number));

const Answer = Schema.Union([
  Schema.Struct({ type: Schema.Literal('noul'), noul: Schema.Number }),
  Schema.Struct({
    type: Schema.Literal('choice'),
    choice: Schema.String,
    probabilities: Probabilities,
    confidence: Schema.optional(Schema.Number),
  }),
  Schema.Struct({
    type: Schema.Literal('score'),
    score: Schema.Number,
    probabilities: Probabilities,
    confidence: Schema.optional(Schema.Number),
  }),
]);

const Reply = Schema.Struct({
  answers: Schema.Record(Schema.String, Schema.Unknown),
  usage: Schema.optional(Schema.Struct({ input_tokens: Schema.Number, output_tokens: Schema.Number })),
});

const malformed = (detail: string) =>
  new DecisionRefused({ reason: 'malformed', message: `The decision answer could not be read: ${detail}` });

const instructionsOf = (general: string | undefined, own: DecisionContent | undefined): DecisionContent => {
  if (general === undefined) return own ?? '';
  if (own === undefined) return general;
  return typeof own === 'string' ? `${general}\n\n${own}` : [general, own];
};

export const decisionsBody = (model: string, request: DecisionRequest): string =>
  JSON.stringify({
    model,
    state: request.state,
    questions: Object.fromEntries(
      Object.entries(request.questions).map(([name, question]) => [
        name,
        {
          type: question.type,
          instructions: instructionsOf(request.instructions, question.instructions),
          ...(question.criteria === undefined ? {} : { criteria: question.criteria }),
        },
      ]),
    ),
  });

const verdictOf = (name: string, question: DecisionQuestion, value: unknown): Effect.Effect<DecisionVerdict, DecisionRefused> =>
  Schema.decodeUnknownEffect(Answer)(value).pipe(
    Effect.mapError((issue) => malformed(`${name}: ${issue.message}`)),
    Effect.flatMap((answer): Effect.Effect<DecisionVerdict, DecisionRefused> => {
      if (answer.type !== question.type)
        return Effect.fail(malformed(`${name} was asked as ${question.type} and answered as ${answer.type}`));
      switch (answer.type) {
        case 'noul':
          return Effect.succeed({ type: 'noul', noul: answer.noul >= 0.5, probability: answer.noul });
        case 'choice':
          return question.type === 'choice' && !(answer.choice in question.criteria)
            ? Effect.fail(malformed(`${name} chose ${answer.choice}, which is not one of its options`))
            : Effect.succeed({
                type: 'choice',
                choice: answer.choice,
                probabilities: answer.probabilities ?? null,
                confidence: answer.confidence ?? null,
              });
        case 'score':
          return Effect.succeed({
            type: 'score',
            score: answer.score,
            probabilities: answer.probabilities ?? null,
            confidence: answer.confidence ?? null,
          });
      }
    }),
  );

const answered = Effect.fn('Decisions.answered')(function* (
  route: DecisionsRoute,
  model: string,
  request: DecisionRequest,
  response: HttpClientResponse.HttpClientResponse,
) {
  const text = yield* response.text.pipe(Effect.mapError((failure) => malformed(failure.message)));
  const reply = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Reply))(text).pipe(
    Effect.mapError((issue) => malformed(issue.message)),
  );
  const answers: Record<string, DecisionVerdict> = {};
  for (const [name, question] of Object.entries(request.questions)) answers[name] = yield* verdictOf(name, question, reply.answers[name]);
  return {
    model: new ModelIdentity({ provider: ProviderID.make(route.provider), model: ModelID.make(model) }),
    answers,
    usage:
      reply.usage === undefined ? undefined : new Usage({ inputTokens: reply.usage.input_tokens, outputTokens: reply.usage.output_tokens }),
  } satisfies DecisionAnswer;
});

export const decide = Effect.fn('Decisions.decide')(function* (route: DecisionsRoute, model: string, request: DecisionRequest) {
  const executor = yield* HttpExecutor;
  const body = decisionsBody(model, request);
  const headers = yield* Auth.toEffect(route.auth)({
    method: 'POST',
    url: route.url,
    body,
    headers: namedHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
  }).pipe(Effect.mapError(providerRefusal));
  return yield* Effect.scopedWith((lifetime) =>
    executor.execute(ProviderShared.jsonPost({ url: route.url, body, headers }), lifetime).pipe(
      Effect.mapError(providerRefusal),
      Effect.flatMap((response) => answered(route, model, request, response)),
    ),
  );
});
