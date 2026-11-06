import { Schema } from 'effect';

export const PLUGIN_ID_PATTERN = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/u;

export const PluginId = Schema.String.check(Schema.isPattern(PLUGIN_ID_PATTERN), Schema.isMaxLength(64)).annotate({
  description: 'The plugin, named as its package names itself, a `.` read as `-`.',
});

export const PLUGIN_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u;

export const PluginLabel = Schema.String.check(Schema.isPattern(PLUGIN_LABEL_PATTERN), Schema.isMaxLength(40)).annotate({
  description: 'A plugin in Tagma’s format: lowercase letters, digits and inner hyphens, so it names a site and its agents.',
});

export const pluginIdOf = (name: string): string => name.replaceAll('.', '-');

export const componentName = (plugin: string, name: string): string => `${plugin}-${name}`;

export const PLUGIN_CALLER_PREFIX = 'plugin:';

export const pluginCaller = (id: string): string => `${PLUGIN_CALLER_PREFIX}${id}`;
