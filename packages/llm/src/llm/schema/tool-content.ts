import { Schema } from 'effect';

export interface ToolTextContent extends Schema.Schema.Type<typeof ToolTextContent> {}
export const ToolTextContent = Schema.Struct({
  type: Schema.Literal('text'),
  text: Schema.String,
}).annotate({ identifier: 'Tool.TextContent' });

export interface ToolFileContent extends Schema.Schema.Type<typeof ToolFileContent> {}
export const ToolFileContent = Schema.Struct({
  type: Schema.Literal('file'),
  uri: Schema.String,
  mime: Schema.String,
  name: Schema.optional(Schema.String),
  width: Schema.optional(Schema.Int),
  height: Schema.optional(Schema.Int),
}).annotate({ identifier: 'Tool.FileContent' });

export const ToolContent = Schema.Union([ToolTextContent, ToolFileContent])
  .pipe(Schema.toTaggedUnion('type'))
  .annotate({ identifier: 'LLM.ToolContent' });
export type ToolContent = Schema.Schema.Type<typeof ToolContent>;
