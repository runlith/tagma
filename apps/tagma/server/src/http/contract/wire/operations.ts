import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { ANSWER_HEADER, ANSWER_TEXT, CALL_HEADER, MEDIA_HEADER, MEDIA_INLINE } from '../../../invocation/contract/wire/headers.js';
import { refusalSchema } from '../../../platform/contract/wire/refusal.js';
import type { OperationId } from '../../../platform/contract/wire/ids.js';
import { lensQuery } from './Caller.js';

export type CallAnnotation = {
  readonly endpoint: string;
  readonly operation?: OperationId;
};

export const callAnnotation = (endpoint: string, operation: OperationId | undefined): CallAnnotation =>
  operation === undefined ? { endpoint } : { endpoint, operation };

export const OperationsGroup = HttpApiGroup.make('operations').add(
  HttpApiEndpoint.post('perform', '/api/op/:id', {
    disableCodecs: true,
    params: { id: Schema.String.check(Schema.isMinLength(1)) },
    query: lensQuery.fields,
    headers: Schema.Struct({
      [CALL_HEADER]: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
      [MEDIA_HEADER]: Schema.optional(Schema.Literal(MEDIA_INLINE)),
      [ANSWER_HEADER]: Schema.optional(Schema.Literal(ANSWER_TEXT)),
    }),
    payload: Schema.Unknown,
    success: Schema.Unknown,
    error: refusalSchema,
  }),
);

export const endpointName = (group: string, endpoint: string): string => `${group}.${endpoint}`;

export const endpointAnnotation = (group: string, endpoint: string): CallAnnotation =>
  callAnnotation(endpointName(group, endpoint), undefined);
