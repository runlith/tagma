import { Result, Schema } from 'effect';
import { AppViewDocument, McpViewDocument } from './load.js';

const ViewIdentity = Schema.Union([AppViewDocument, McpViewDocument]);
export type ViewIdentity = typeof ViewIdentity.Type;

const PREFIX = 'tagma-view:';

const decode = Schema.decodeUnknownResult(Schema.fromJsonString(ViewIdentity));

export const viewFrameName = (view: ViewIdentity): string => `${PREFIX}${JSON.stringify(view)}`;

export const viewOfFrameName = (name: string): ViewIdentity | undefined => {
  if (!name.startsWith(PREFIX)) return undefined;
  const view = decode(name.slice(PREFIX.length));
  return Result.isSuccess(view) ? view.success : undefined;
};
