import { Schema } from 'effect';

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

export const Position = Schema.Struct({
  path: Schema.String,
  line: Count,
  column: Count,
});
export type Position = typeof Position.Type;

export const Place = Schema.Struct({ ...Position.fields, text: Schema.String });
export type Place = typeof Place.Type;

export const USE_KINDS = ['declaration', 'call', 'implementation', 'value', 'type', 'import', 'alias'] as const;
export const UseKind = Schema.Literals(USE_KINDS);
export type UseKind = typeof UseKind.Type;

export const UNVERIFIED_REASONS = [
  'changed',
  'no-adapter',
  'no-program',
  'untyped',
  'unparsed',
  'degraded',
  'unclear',
  'alias-cut',
] as const;
export const UnverifiedReason = Schema.Literals(UNVERIFIED_REASONS);
export type UnverifiedReason = typeof UnverifiedReason.Type;

export const Verdict = Schema.Union([
  Schema.TaggedStruct('use', { kind: UseKind, within: Schema.NullOr(Schema.String) }),
  Schema.TaggedStruct('other', { symbol: Schema.String }),
  Schema.TaggedStruct('text', {}),
  Schema.TaggedStruct('unverified', { reason: UnverifiedReason }),
]);
export type Verdict = typeof Verdict.Type;
