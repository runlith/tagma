import { Schema } from 'effect';

export const pathExistsReportSchema = Schema.Struct({
  exists: Schema.Boolean,
});

export type PathExistsReport = Schema.Schema.Type<typeof pathExistsReportSchema>;
