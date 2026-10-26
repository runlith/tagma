import { Schema } from 'effect';

export type Door = { readonly file: string; readonly text: string };

export type Job = {
  readonly entry: string;
  readonly files: Readonly<Record<string, string>>;
  readonly absent: readonly string[];
  readonly doors: Readonly<Record<string, Door>>;
};

const Read = { loaded: Schema.Array(Schema.String), missed: Schema.Array(Schema.String) };

export const Place = Schema.Struct({ file: Schema.String, line: Schema.NullOr(Schema.Int), reason: Schema.String });
export type Place = typeof Place.Type;

export const Answer = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('wanted'), paths: Schema.Array(Schema.String) }),
  Schema.Struct({ _tag: Schema.Literal('refused'), ...Place.fields, ...Read }),
  Schema.Struct({ _tag: Schema.Literal('evaluated'), value: Schema.Unknown, ...Read }),
]);
export type Answer = typeof Answer.Type;
