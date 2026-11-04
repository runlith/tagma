import { Schema } from 'effect';

export const ArchiveFootprint = Schema.Struct({ bytes: Schema.Int, entries: Schema.Int });
export type ArchiveFootprint = typeof ArchiveFootprint.Type;

export const ArchiveAsk = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Inspect'), id: Schema.Int, file: Schema.NonEmptyString }),
  Schema.Struct({ _tag: Schema.Literal('Unpack'), id: Schema.Int, file: Schema.NonEmptyString, into: Schema.NonEmptyString }),
]);
export type ArchiveAsk = typeof ArchiveAsk.Type;

export const ArchiveMessage = Schema.Union([ArchiveAsk, Schema.Struct({ _tag: Schema.Literal('Cancel') })]);

export const ArchiveAnswer = Schema.Union([
  Schema.Struct({ id: Schema.Int, footprint: ArchiveFootprint }),
  Schema.Struct({ id: Schema.Int, unpacked: Schema.Literal(true) }),
  Schema.Struct({ id: Schema.Int, refused: Schema.String }),
]);
export type ArchiveAnswer = typeof ArchiveAnswer.Type;
