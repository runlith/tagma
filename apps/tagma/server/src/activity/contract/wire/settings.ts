import { Schema } from 'effect';
import { settingKey } from '../../../platform/contract/wire/setting.js';

const ACTIVITY_SCOPES = ['user'] as const;

export const activityKeepHours = settingKey({
  id: 'activity.keepHours',
  order: 750,
  title: 'Activity kept',
  description: 'How long a finished activity stays readable: who did what, why, with which model and to what effect.',
  schema: Schema.Int.check(Schema.isGreaterThan(0)),
  control: { kind: 'number', minimum: 1, step: 1, unit: 'hours' },
  fallback: 24,
  scopes: ACTIVITY_SCOPES,
  merge: 'replace',
});

export const activityBodiesMaxBytes = settingKey({
  id: 'activity.bodiesMaxBytes',
  order: 755,
  title: 'Activity bodies',
  description: 'How much the requests and answers kept beside activities may take on disk; the oldest hours go first.',
  schema: Schema.Int.check(Schema.isGreaterThan(0)),
  control: { kind: 'number', minimum: 1, step: 1, unit: 'bytes' },
  fallback: 2 * 1024 * 1024 * 1024,
  scopes: ACTIVITY_SCOPES,
  merge: 'replace',
});

export const ACTIVITY_SETTING_SECTIONS = [
  {
    id: 'activity',
    order: 75,
    title: 'Activity',
    description: 'How long the record of what the product did is kept, and how much room its bodies take.',
  },
] as const;

export const ACTIVITY_SETTING_KEYS = [activityKeepHours, activityBodiesMaxBytes] as const;
