import { Effect, Schema } from 'effect';
import { type DeclaredAnswer, knownAnswer } from '../wire/operation.js';

export type Performable = {
  readonly id: string;
  readonly input: Schema.Codec<any, unknown>;
  readonly answer: Schema.Codec<any, unknown>;
};

export type DoorLens = {
  readonly cwd?: string;
  readonly project?: string;
  readonly branch?: string;
  readonly scope?: string;
};

export type Perform = <D extends Performable>(
  declaration: D,
  input: D['input']['Type'],
  lens: DoorLens,
) => Effect.Effect<DeclaredAnswer<D['answer']>, unknown>;

export type PerformRequest = {
  readonly params: { readonly id: string };
  readonly query: DoorLens;
  readonly headers: {};
  readonly payload: unknown;
};

export const performOver =
  (send: (request: PerformRequest) => Effect.Effect<unknown, unknown>): Perform =>
  (declaration, input, lens) =>
    Effect.flatMap(Schema.encodeUnknownEffect(declaration.input)(input), (payload) =>
      send({ params: { id: declaration.id }, query: lens, headers: {}, payload }),
    ).pipe(Effect.flatMap((answered) => Schema.decodeUnknownEffect(knownAnswer(declaration.answer))(answered)));
