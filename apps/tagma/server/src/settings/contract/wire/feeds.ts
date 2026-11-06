import { Schema } from 'effect';
import { feed } from '../../../platform/contract/wire/operation.js';

export const WatchedSettings = Schema.Struct({ values: Schema.Record(Schema.String, Schema.Json) });
export type WatchedSettings = typeof WatchedSettings.Type;

const SETTINGS_WATCH_FEED = feed('settings.watch', {
  input: Schema.Struct({
    keys: Schema.Array(Schema.String.check(Schema.isMinLength(1))),
  }),
  event: WatchedSettings,
  refusals: ['unknown-setting', 'setting-scope'],
  callers: 'operator',
  graph: 'none',
});

export const SETTINGS_FEEDS = [SETTINGS_WATCH_FEED] as const;
