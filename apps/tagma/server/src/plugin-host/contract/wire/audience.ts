import { Schema } from 'effect';
import type { PluginFace } from '../../../platform/contract/wire/contribution.js';

const MODEL_NAME_MAX = 64;

const TOOL_AUDIENCES = ['agents', 'own', 'view', 'tagma'] as const;
export type ToolAudience = (typeof TOOL_AUDIENCES)[number];

export const pluginToolName = (plugin: string, tool: string): string => `plugin__${plugin}__${tool}`;

const InputSchema = Schema.StructWithRest(Schema.Struct({ type: Schema.Literal('object') }), [
  Schema.Record(Schema.String, Schema.Unknown),
]).annotate({ description: 'The JSON Schema of its input: an object at the root.' });

export const ToolEntry = Schema.Struct({
  name: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]+$/u)).annotate({ description: 'The tool, as the process lists it.' }),
  audience: Schema.Literals(TOOL_AUDIENCES).annotate({
    description:
      'agents: offered, deferred, to every agent in a project where the plugin is enabled. own: only to the plugin’s own agents. view: only to the plugin’s views. tagma: called by Tagma alone, for a point that names it.',
  }),
  description: Schema.NonEmptyString.annotate({ description: 'What the tool does, as an agent reads it.' }),
  inputSchema: InputSchema,
  annotations: Schema.optional(
    Schema.Struct({
      title: Schema.optional(Schema.String),
      readOnlyHint: Schema.optional(Schema.Boolean),
      destructiveHint: Schema.optional(Schema.Boolean),
      idempotentHint: Schema.optional(Schema.Boolean),
      openWorldHint: Schema.optional(Schema.Boolean),
    }),
  ).annotate({ description: 'The MCP tool annotations; readOnlyHint true lets it run without asking in review mode.' }),
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

export const TOOLS_FACE: PluginFace<ToolEntries> = {
  name: 'tools',
  title: 'Tools agents can call',
  schema: ToolEntries,
  refuses: (entries, { plugin }) => {
    const long = entries
      .filter((entry) => entry.audience !== 'tagma' && pluginToolName(plugin, entry.name).length > MODEL_NAME_MAX)
      .map((entry) => entry.name);
    return long.length === 0 ? null : `${long.join(', ')} named under ${plugin} pass the ${MODEL_NAME_MAX} characters a model accepts`;
  },
  serves: (entries, tool) => {
    const audience = entries?.find((entry) => entry.name === tool)?.audience;
    if (audience === undefined) return `contributes.tools names no tool ${tool}`;
    return audience === 'tagma'
      ? null
      : `the tool ${tool} is offered to ${audience}, and a point calls only a tool whose audience is tagma`;
  },
};
