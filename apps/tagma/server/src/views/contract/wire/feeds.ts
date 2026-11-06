import { Schema } from 'effect';
import { McpResourceEvent } from '@runlith/mcp/apps';
import { feed } from '../../../platform/contract/wire/operation.js';
import { PluginActionState } from './actions.js';
import { PluginViewState, pluginName, VIEW_REFUSALS } from './sets.js';
import { ViewId } from './points.js';

const projectId = Schema.Int.check(Schema.isGreaterThan(0));

export const VIEW_SETS_FEED = feed('views.subscribe', {
  input: Schema.Struct({ projectId }),
  event: PluginViewState,
  refusals: ['unknown-project'],
  callers: 'operator',
  admission: 'project',
});

export const VIEW_RESOURCE_FEED = feed('views.resource.subscribe', {
  input: Schema.Struct({ projectId, plugin: pluginName, view: ViewId, uri: Schema.String.check(Schema.isMinLength(1)) }),
  event: McpResourceEvent,
  refusals: VIEW_REFUSALS,
  callers: 'operator',
  admission: 'project',
});

const VIEW_ACTIONS_FEED = feed('views.actions', {
  input: Schema.Struct({}),
  event: PluginActionState,
  refusals: [],
  callers: 'operator',
  graph: 'none',
});

export const VIEW_FEEDS = [VIEW_SETS_FEED, VIEW_RESOURCE_FEED, VIEW_ACTIONS_FEED] as const;
