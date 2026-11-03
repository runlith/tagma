import { Schema } from 'effect';

export const ArchiveFootprint = Schema.Struct({ bytes: Schema.Int, entries: Schema.Int });
export type ArchiveFootprint = typeof ArchiveFootprint.Type;

export const ArchiveAsk = Schema.Struct({ id: Schema.Int, file: Schema.NonEmptyString });
export type ArchiveAsk = typeof ArchiveAsk.Type;

export const ArchiveInspection = Schema.Union([
  Schema.Struct({ id: Schema.Int, footprint: ArchiveFootprint }),
  Schema.Struct({ id: Schema.Int, refused: Schema.String }),
]);
export type ArchiveInspection = typeof ArchiveInspection.Type;
