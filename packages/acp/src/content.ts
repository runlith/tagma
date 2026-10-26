import { Schema } from 'effect';

export const Meta = Schema.optional(Schema.Unknown);

export const Text = Schema.optionalKey(Schema.NullOr(Schema.String));

export const TextContent = Schema.Struct({
  type: Schema.Literal('text'),
  text: Schema.String,
  annotations: Schema.optional(Schema.Unknown),
  _meta: Meta,
});

export const ImageContent = Schema.Struct({
  type: Schema.Literal('image'),
  data: Schema.String,
  mimeType: Schema.String,
  uri: Text,
  annotations: Schema.optional(Schema.Unknown),
  _meta: Meta,
});

export const AudioContent = Schema.Struct({
  type: Schema.Literal('audio'),
  data: Schema.String,
  mimeType: Schema.String,
  annotations: Schema.optional(Schema.Unknown),
  _meta: Meta,
});

export const ResourceLink = Schema.Struct({
  type: Schema.Literal('resource_link'),
  uri: Schema.String,
  name: Schema.String,
  title: Text,
  description: Text,
  mimeType: Text,
  size: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  annotations: Schema.optional(Schema.Unknown),
  _meta: Meta,
});

export const ResourceContents = Schema.Union([
  Schema.Struct({ uri: Schema.String, text: Schema.String, mimeType: Text, _meta: Meta }),
  Schema.Struct({ uri: Schema.String, blob: Schema.String, mimeType: Text, _meta: Meta }),
]);

export const EmbeddedResource = Schema.Struct({
  type: Schema.Literal('resource'),
  resource: ResourceContents,
  annotations: Schema.optional(Schema.Unknown),
  _meta: Meta,
});

export const ContentBlock = Schema.Union([TextContent, ImageContent, AudioContent, ResourceLink, EmbeddedResource]);
export type ContentBlock = typeof ContentBlock.Type;
