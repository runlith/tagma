import type { Availability } from '@runlith/audio/port/devices';
import { Context, Effect, Result, Schema, Scope } from 'effect';
import { SpeechFailure } from '../wire/failure.ts';
import type { AnyProvider, SpeechCatalog } from './catalog.ts';
import type { Conditions } from './choose.ts';
import { SpeechCredentials } from './SpeechCredentials.ts';

export const credentialOf = Effect.fnUntraced(function* <R>(
  provider: AnyProvider<R>,
  account: string | undefined,
): Effect.fn.Return<unknown, SpeechFailure, SpeechCredentials> {
  const form = provider.credential;
  if (form._tag === 'none') return form.value;
  const credentials = yield* SpeechCredentials;
  const raw = yield* Effect.result(credentials.get(provider.id, account));
  if (Result.isFailure(raw))
    return yield* Effect.fail(new SpeechFailure({ reason: 'auth', message: raw.failure.message, retryable: raw.failure.retryable }));
  const decoded = Schema.decodeUnknownResult(form.schema)(raw.success);
  if (Result.isFailure(decoded))
    return yield* Effect.fail(SpeechFailure.auth(`the credential stored for ${provider.id} does not fit its form`));
  return decoded.success;
});

const credentialAvailability = Effect.fnUntraced(function* <R>(
  provider: AnyProvider<R>,
  account: string | undefined,
): Effect.fn.Return<Availability, never, SpeechCredentials> {
  if (provider.credential._tag === 'none') return { _tag: 'present' };
  const credentials = yield* SpeechCredentials;
  const raw = yield* Effect.result(credentials.get(provider.id, account));
  if (Result.isSuccess(raw)) return { _tag: 'present' };
  return { _tag: 'absent', reason: raw.failure.message, unblock: raw.failure.unblock };
});

export const conditions = Effect.fnUntraced(function* <R>(
  catalog: SpeechCatalog<R>,
  detector: Availability,
  account: string | undefined,
): Effect.fn.Return<Conditions, never, SpeechCredentials> {
  const known = new Map<string, Availability>();
  for (const provider of catalog.providers) {
    const credential = yield* credentialAvailability(provider, account);
    const models = [...(provider.recognizer?.models ?? []), ...(provider.synthesizer?.models ?? [])];
    for (const model of models) {
      const own = yield* provider.availability(model.id);
      known.set(`${provider.id}\u0000${model.id}`, own._tag === 'absent' ? own : credential);
    }
  }
  const absent: Availability = { _tag: 'absent', reason: 'the model is not registered', unblock: [] };
  return {
    detector,
    model: (provider, model) => known.get(`${provider}\u0000${model}`) ?? absent,
  };
});

export const within = <A, E, R>(
  effect: Effect.Effect<A, E, R | Scope.Scope>,
  context: Context.Context<R>,
): Effect.Effect<A, E, Scope.Scope> =>
  Effect.flatMap(Effect.scope, (scope) => Effect.provideContext(effect, Context.add(context, Scope.Scope, scope)));

export const rateFor = (offered: ReadonlyArray<number>, source: number): number => {
  if (offered.includes(source)) return source;
  const sorted = [...offered].sort((left, right) => left - right);
  return sorted.find((rate) => rate >= source) ?? sorted[sorted.length - 1] ?? source;
};
