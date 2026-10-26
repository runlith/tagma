import { Schema } from 'effect';

export const MANIFEST_FILE = 'plugin.json';

export const PLUGIN_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u;

export const PluginId = Schema.String.check(Schema.isPattern(PLUGIN_ID_PATTERN), Schema.isMaxLength(40)).annotate({
  description: 'The plugin, named as its directory: lowercase letters, digits and inner hyphens.',
});

export const PluginProcess = Schema.Struct({
  command: Schema.String.check(Schema.isMinLength(1)).annotate({
    description: 'The program that serves MCP over stdio, run from the plugin directory as the operator.',
  }),
  args: Schema.optional(Schema.Array(Schema.String)).annotate({ description: 'Arguments to the command.' }),
});
export type PluginProcess = typeof PluginProcess.Type;

export const PluginEnvelope = Schema.Struct({
  id: PluginId,
  title: Schema.String.check(Schema.isMinLength(1)).annotate({ description: 'What the operator sees the plugin called.' }),
  process: Schema.optional(PluginProcess),
  contributes: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)).annotate({
    description: 'Contributions by point; every point is declared by the owner that registers it.',
  }),
});
export type PluginEnvelope = typeof PluginEnvelope.Type;

export const pluginCaller = (id: string): string => `plugin:${id}`;
