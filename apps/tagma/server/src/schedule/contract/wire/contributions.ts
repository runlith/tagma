import { Schema } from 'effect';
import { Cadence } from './schedule.js';

export const ScheduledTools = Schema.Array(Schema.Struct({ ...Cadence.fields, tool: Schema.NonEmptyString })).check(
  Schema.makeFilter((entries) => new Set(entries.map((entry) => entry.name)).size === entries.length || 'schedule names must be unique'),
);
export type ScheduledTools = typeof ScheduledTools.Type;
