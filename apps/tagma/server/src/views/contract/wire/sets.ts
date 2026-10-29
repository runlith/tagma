import { Schema } from 'effect';
import { TagmaAppId } from '../../../tagma-apps/contract/wire/manifest.js';
import { LauncherEntry, SectionEntry, ViewEntry, ViewId } from './points.js';

export const TagmaAppResult = Schema.Struct({
  tool: Schema.String,
  name: Schema.String.annotate({ description: 'The tool as a thread’s transcript names its call.' }),
  view: ViewId,
});
export type TagmaAppResult = typeof TagmaAppResult.Type;

export const ViewSite = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('served'),
    origin: Schema.String.annotate({
      description: 'The origin of the app’s own site on the door this feed came through; its view entries and icons resolve against it.',
    }),
  }),
  Schema.Struct({ _tag: Schema.Literal('unserved'), reason: Schema.String }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type ViewSite = typeof ViewSite.Type;

export const TagmaAppViewSet = Schema.Struct({
  app: Schema.String,
  title: Schema.String,
  site: ViewSite,
  views: Schema.Array(ViewEntry),
  results: Schema.Array(TagmaAppResult),
  surfaces: Schema.Array(SectionEntry),
  panes: Schema.Array(SectionEntry),
  launchers: Schema.Array(LauncherEntry),
});
export type TagmaAppViewSet = typeof TagmaAppViewSet.Type;

export const TagmaAppViewState = Schema.Struct({
  apps: Schema.Array(TagmaAppViewSet),
  enabled: Schema.Array(TagmaAppId).annotate({
    description:
      'The apps this project enables, running or not: an app missing from `apps` yet listed here is starting, restarting or failed, not withdrawn.',
  }),
});
export type TagmaAppViewState = typeof TagmaAppViewState.Type;

export const VIEW_REFUSALS = [
  'app-view-unknown',
  'app-unavailable',
  'app-tool-unoffered',
  'app-resource-failed',
  'app-call-failed',
  'unknown-project',
] as const;
export type ViewRefusalCode = (typeof VIEW_REFUSALS)[number];

export const STORAGE_REFUSALS = ['app-view-unknown', 'view-storage-failed', 'view-storage-too-large', 'unknown-project'] as const;
export type StorageRefusalCode = (typeof STORAGE_REFUSALS)[number];

export const tagmaAppName = TagmaAppId.annotate({ description: 'The app whose view asks.' });
