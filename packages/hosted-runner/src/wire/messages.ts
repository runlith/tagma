import { Schema } from 'effect';

export const hostedToolSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  inputSchema: Schema.Record(Schema.String, Schema.Unknown),
  mutates: Schema.Boolean,
});
export type HostedToolWire = typeof hostedToolSchema.Type;

export const hostedContentSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal('text'), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal('image'), data: Schema.String, mimeType: Schema.String }),
]);
export type HostedContent = typeof hostedContentSchema.Type;

export const hostedMessageSchema = Schema.Union([
  Schema.Struct({ role: Schema.Literal('user'), content: Schema.Array(hostedContentSchema) }),
  Schema.Struct({
    role: Schema.Literal('assistant'),
    content: Schema.Array(
      Schema.Union([
        Schema.Struct({ type: Schema.Literal('text'), text: Schema.String }),
        Schema.Struct({ type: Schema.Literal('call'), id: Schema.String, name: Schema.String, input: Schema.Unknown }),
      ]),
    ),
  }),
  Schema.Struct({ role: Schema.Literal('result'), id: Schema.String, content: Schema.Array(hostedContentSchema), failed: Schema.Boolean }),
]);
export type HostedMessage = typeof hostedMessageSchema.Type;
