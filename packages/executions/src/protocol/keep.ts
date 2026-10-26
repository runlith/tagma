import { Schema } from 'effect';

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const Disowned = Schema.Struct({
  owner: Schema.optional(Schema.NonEmptyString),
  scope: Schema.optional(Schema.NonEmptyString),
});
export type Disowned = typeof Disowned.Type;

export const DisownReport = Schema.Struct({ retired: Count });
export type DisownReport = typeof DisownReport.Type;

export const KeptRecords = Schema.Struct({
  records: Count,
  bytes: Count,
  reserve: Schema.optional(Count),
  available: Schema.optional(Count),
});
export type KeptRecords = typeof KeptRecords.Type;
