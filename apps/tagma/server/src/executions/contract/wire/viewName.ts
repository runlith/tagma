import { Result, Schema } from 'effect';
import { McpViewDocument } from './load.js';

export type ViewIdentity = typeof McpViewDocument.Type;

const PREFIX = 'tagma-view:';

const decode = Schema.decodeUnknownResult(Schema.fromJsonString(McpViewDocument));

export const viewFrameName = (view: ViewIdentity): string => `${PREFIX}${JSON.stringify(view)}`;

export const viewOfFrameName = (name: string): ViewIdentity | undefined => {
  if (!name.startsWith(PREFIX)) return undefined;
  const view = decode(name.slice(PREFIX.length));
  return Result.isSuccess(view) ? view.success : undefined;
};
