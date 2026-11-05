import { Schema } from 'effect';

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
