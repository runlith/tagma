import { Schema } from 'effect';
import type { PluginFace } from '../../../platform/contract/wire/contribution.js';
import { Cadence } from './schedule.js';

export const ScheduledTools = Schema.Array(Schema.Struct({ ...Cadence.fields, tool: Schema.NonEmptyString })).check(
  Schema.makeFilter((entries) => new Set(entries.map((entry) => entry.name)).size === entries.length || 'schedule names must be unique'),
);
export type ScheduledTools = typeof ScheduledTools.Type;

export const SCHEDULED_FACE: PluginFace<ScheduledTools> = {
  name: 'schedule',
  title: 'Runs on a schedule',
  schema: ScheduledTools,
  calls: (entries) => entries.map((entry) => entry.tool),
};
