import { Schema } from 'effect';
import { PluginId, PluginLabel } from '../../../plugins/contract/wire/names.js';
import { LauncherEntry, SectionEntry, ViewEntry, ViewId } from './points.js';

const PluginResult = Schema.Struct({
  tool: Schema.String,
  name: Schema.String.annotate({ description: 'The tool as a thread’s transcript names its call.' }),
  view: ViewId,
});

export const ViewSite = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('served'),
    origin: Schema.String.annotate({
      description: 'The origin of the plugin’s own site on the door this feed came through; its view entries and icons resolve against it.',
    }),
  }),
  Schema.Struct({ _tag: Schema.Literal('unserved'), reason: Schema.String }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type ViewSite = typeof ViewSite.Type;

export const PluginViewSet = Schema.Struct({
  plugin: Schema.String,
  title: Schema.String,
  site: ViewSite,
  views: Schema.Array(ViewEntry),
  results: Schema.Array(PluginResult),
  surfaces: Schema.Array(SectionEntry),
  panes: Schema.Array(SectionEntry),
  launchers: Schema.Array(LauncherEntry),
});
export type PluginViewSet = typeof PluginViewSet.Type;

export const PluginViewState = Schema.Struct({
  plugins: Schema.Array(PluginViewSet),
  enabled: Schema.Array(PluginId).annotate({
    description:
      'The plugins this project enables, running or not: a plugin missing from `plugins` yet listed here is starting, restarting or failed, not withdrawn.',
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
