import { Schema } from 'effect';

export const TOOL_AUDIENCES = ['agents', 'own', 'view'] as const;
export type ToolAudience = (typeof TOOL_AUDIENCES)[number];

export const pluginToolName = (plugin: string, tool: string): string => `plugin__${plugin}__${tool}`;

export const ToolEntry = Schema.Struct({
  name: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]+$/u)).annotate({ description: 'The tool, as the process lists it.' }),
  audience: Schema.Literals(TOOL_AUDIENCES).annotate({
    description:
      'agents: offered, deferred, to every agent in a project where the plugin is enabled. own: only to the plugin’s own agents. view: only to the plugin’s views.',
  }),
});
export type ToolEntry = typeof ToolEntry.Type;

export const ToolEntries = Schema.Array(ToolEntry).check(
  Schema.makeFilter((entries: readonly ToolEntry[]) => {
    const seen = new Set<string>();
    for (const { name } of entries) {
      if (seen.has(name)) return `the tool ${name} is listed twice`;
      seen.add(name);
    }
    return true;
  }),
);
export type ToolEntries = typeof ToolEntries.Type;
