import { Schema } from 'effect';
import { PluginId, PluginLabel } from '../../../plugins/contract/wire/names.js';
import { ViewModule } from './modules.js';
import { LauncherEntry, SectionEntry, ViewEntry, ViewId } from './points.js';

const PluginResult = Schema.Struct({
  tool: Schema.String,
  name: Schema.String.annotate({ description: 'The tool as a thread’s transcript names its call.' }),
  view: ViewId,
});

const ShownView = Schema.Struct({
  id: ViewId,
  live: ViewEntry.fields.live,
  media: ViewEntry.fields.media,
  module: ViewModule,
});

const ShownSection = Schema.Struct({
  view: ViewId,
  title: SectionEntry.fields.title,
  icon: Schema.NullOr(Schema.String).annotate({
    description: 'The address of its icon on the door the feed came through; null draws a neutral plugin glyph.',
  }),
});
export type ShownSection = typeof ShownSection.Type;

export const PluginViewSet = Schema.Struct({
  plugin: Schema.String,
  title: Schema.String,
  views: Schema.Array(ShownView),
  results: Schema.Array(PluginResult),
  composer: Schema.Array(Schema.Struct({ view: ViewId })).annotate({ description: 'The views drawn above a thread’s composer.' }),
  surfaces: Schema.Array(ShownSection),
  panes: Schema.Array(ShownSection),
  launchers: Schema.Array(LauncherEntry),
});
export type PluginViewSet = typeof PluginViewSet.Type;

export const PluginViewState = Schema.Struct({
  plugins: Schema.Array(PluginViewSet),
  enabled: Schema.Array(PluginId).annotate({
    description:
      'The plugins this project enables, running or not: a plugin missing from `plugins` yet listed here is starting, restarting or failed, not withdrawn.',
  }),
  sheet: Schema.NullOr(Schema.String).annotate({
    description:
      'The address of the utilities sheet holding the window’s classes and every published plugin’s; null when no plugin adds a class.',
  }),
});
export type PluginViewState = typeof PluginViewState.Type;

export const VIEW_REFUSALS = [
  'plugin-view-unknown',
  'plugin-unavailable',
  'plugin-tool-unoffered',
  'plugin-resource-failed',
  'plugin-call-failed',
  'unknown-project',
] as const;
export type ViewRefusalCode = (typeof VIEW_REFUSALS)[number];

export const STORAGE_REFUSALS = [
  'plugin-view-unknown',
  'plugin-unavailable',
  'view-storage-failed',
  'view-storage-too-large',
  'unknown-project',
] as const;
export type StorageRefusalCode = (typeof STORAGE_REFUSALS)[number];

export const pluginName = PluginLabel.annotate({ description: 'The plugin whose view asks.' });
