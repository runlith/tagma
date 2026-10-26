import { Schema } from 'effect';
import { ContentBlock, Meta, Text } from './content';

export const ToolKind = Schema.Literals(['read', 'edit', 'delete', 'move', 'search', 'execute', 'think', 'fetch', 'switch_mode', 'other']);
export type ToolKind = typeof ToolKind.Type;

export const ToolCallStatus = Schema.Literals(['pending', 'in_progress', 'completed', 'failed']);
export type ToolCallStatus = typeof ToolCallStatus.Type;

export const ToolCallContent = Schema.Union([
  Schema.Struct({ type: Schema.Literal('content'), content: ContentBlock, _meta: Meta }),
  Schema.Struct({ type: Schema.Literal('diff'), path: Schema.String, oldText: Text, newText: Schema.String, _meta: Meta }),
  Schema.Struct({ type: Schema.Literal('terminal'), terminalId: Schema.String, _meta: Meta }),
]);
export type ToolCallContent = typeof ToolCallContent.Type;

export const ToolCallLocation = Schema.Struct({
  path: Schema.String,
  line: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  _meta: Meta,
});
export type ToolCallLocation = typeof ToolCallLocation.Type;

export const ToolCall = Schema.Struct({
  toolCallId: Schema.String,
  title: Schema.String,
  name: Text,
  kind: Schema.optional(ToolKind),
  status: Schema.optional(ToolCallStatus),
  content: Schema.optional(Schema.Array(ToolCallContent)),
  locations: Schema.optional(Schema.Array(ToolCallLocation)),
  rawInput: Schema.optional(Schema.Unknown),
  rawOutput: Schema.optional(Schema.Unknown),
  _meta: Meta,
});
export type ToolCall = typeof ToolCall.Type;

export const ToolCallUpdate = Schema.Struct({
  toolCallId: Schema.String,
  title: Text,
  name: Text,
  kind: Schema.optionalKey(Schema.NullOr(ToolKind)),
  status: Schema.optionalKey(Schema.NullOr(ToolCallStatus)),
  content: Schema.optionalKey(Schema.NullOr(Schema.Array(ToolCallContent))),
  locations: Schema.optionalKey(Schema.NullOr(Schema.Array(ToolCallLocation))),
  rawInput: Schema.optionalKey(Schema.Unknown),
  rawOutput: Schema.optionalKey(Schema.Unknown),
  _meta: Meta,
});
export type ToolCallUpdate = typeof ToolCallUpdate.Type;
