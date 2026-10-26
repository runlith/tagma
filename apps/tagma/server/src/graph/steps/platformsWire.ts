import { Schema } from 'effect';

const Row = Schema.Struct({ id: Schema.Int, fields: Schema.Record(Schema.String, Schema.Unknown) });

export const PlatformJob = Schema.Struct({ root: Schema.String, rows: Schema.Array(Row) });
export type PlatformJob = typeof PlatformJob.Type;

export const PlatformAnswer = Schema.Union([
  Schema.Struct({ state: Schema.Literal('changed'), rows: Schema.Array(Row) }),
  Schema.Struct({ state: Schema.Literal('failed'), message: Schema.String }),
]);
export type PlatformAnswer = typeof PlatformAnswer.Type;
