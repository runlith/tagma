import { Schema } from 'effect';
import type { PluginFace } from '../../../platform/contract/wire/contribution.js';
import { PLUGIN_LABEL_PATTERN } from '../../../plugins/contract/wire/names.js';

export const pluginCapability = (plugin: string): string => `plugin:${plugin}`;

export const pluginAgentId = (plugin: string, agent: string): string => `${plugin}.${agent}`;

export const PluginAgentEntry = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(PLUGIN_LABEL_PATTERN), Schema.isMaxLength(40)).annotate({
    description: 'The agent inside the plugin; Tagma offers it as <plugin>.<id>.',
  }),
  path: Schema.String.check(Schema.isPattern(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+\.md$/u)).annotate({
    description:
      'Its definition, a Markdown file with frontmatter, relative to the plugin directory. It names its capabilities; plugin:<plugin> is added to them.',
  }),
});
export type PluginAgentEntry = typeof PluginAgentEntry.Type;

export const PluginAgentEntries = Schema.Array(PluginAgentEntry).check(
  Schema.makeFilter((entries: readonly PluginAgentEntry[]) => {
    const seen = new Set<string>();
    for (const { id } of entries) {
      if (seen.has(id)) return `the agent ${id} is listed twice`;
      seen.add(id);
    }
    return true;
  }),
);
export type PluginAgentEntries = typeof PluginAgentEntries.Type;

export const PLUGIN_AGENTS_FACE: PluginFace<PluginAgentEntries> = {
  name: 'agents',
  title: 'Agents you can start',
  schema: PluginAgentEntries,
};
