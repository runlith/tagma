import { Schema } from 'effect';
import { feed } from '../../../platform/contract/wire/operation.js';
import { PluginId } from '../../../plugins/contract/wire/names.js';
import { Theme } from './format.js';

const OfferedTheme = Schema.Struct({
  id: Schema.String,
  plugin: PluginId,
  pluginTitle: Schema.String,
  theme: Theme,
});

const ThemeCatalog = Schema.Struct({ themes: Schema.Array(OfferedTheme) });
export type ThemeCatalog = typeof ThemeCatalog.Type;

const APPEARANCE_FEED = feed('appearance.subscribe', {
  input: Schema.Struct({}),
  event: ThemeCatalog,
  refusals: [],
  callers: 'operator',
  graph: 'none',
});

export const APPEARANCE_FEEDS = [APPEARANCE_FEED] as const;
