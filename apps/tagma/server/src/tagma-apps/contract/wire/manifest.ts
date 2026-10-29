import { Schema } from 'effect';

export const MANIFEST_FILE = 'tagma-app.json';

export const TAGMA_APP_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u;

export const TagmaAppId = Schema.String.check(Schema.isPattern(TAGMA_APP_ID_PATTERN), Schema.isMaxLength(40)).annotate({
  description: 'The app, named as its directory: lowercase letters, digits and inner hyphens.',
});

export const TagmaAppProcess = Schema.Struct({
  command: Schema.String.check(Schema.isMinLength(1)).annotate({
    description: 'The program that serves MCP over stdio, run from the app directory as the operator.',
  }),
  args: Schema.optional(Schema.Array(Schema.String)).annotate({ description: 'Arguments to the command.' }),
});
export type TagmaAppProcess = typeof TagmaAppProcess.Type;

export const TagmaAppEnvelope = Schema.Struct({
  id: TagmaAppId,
  title: Schema.String.check(Schema.isMinLength(1)).annotate({ description: 'What the operator sees the app called.' }),
  process: Schema.optional(TagmaAppProcess),
  contributes: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)).annotate({
    description: 'Contributions by point; every point is declared by the owner that registers it.',
  }),
});
export type TagmaAppEnvelope = typeof TagmaAppEnvelope.Type;

export const tagmaAppCaller = (id: string): string => `app:${id}`;
