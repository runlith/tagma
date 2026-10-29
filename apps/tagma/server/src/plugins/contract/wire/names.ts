import { Schema } from 'effect';

export const PLUGIN_ID_PATTERN = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/u;

export const PluginId = Schema.String.check(Schema.isPattern(PLUGIN_ID_PATTERN), Schema.isMaxLength(64)).annotate({
  description: 'The plugin, named as its package names itself, a `.` read as `-`.',
});

export const pluginIdOf = (name: string): string => name.replaceAll('.', '-');

export const componentName = (plugin: string, name: string): string => `${plugin}-${name}`;
