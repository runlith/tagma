import { lensQuery } from './Caller.js';
import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api';
import { THREAD_ATTACHMENT_MEDIA_TYPES } from '@runlith/agent/transcript/attachments';
import { missingSchema, refusalSchema } from '../../../platform/contract/wire/refusal.js';

const id = Schema.Struct({ id: Schema.String });

const attachmentSchema = Schema.Struct({ id: Schema.String, mediaType: Schema.String, url: Schema.String });

const uploadQuery = Schema.Struct({ ...lensQuery.fields, name: Schema.optional(Schema.String) });

export const ThreadsGroup = HttpApiGroup.make('threads')
  .add(
    HttpApiEndpoint.post('upload', '/api/threads/:id/attachments', {
      query: uploadQuery,
      params: id,
      headers: Schema.Struct({ 'content-type': Schema.optional(Schema.String) }),
      payload: THREAD_ATTACHMENT_MEDIA_TYPES.map((mediaType) =>
        Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array({ contentType: mediaType })),
      ),
      success: attachmentSchema.pipe(HttpApiSchema.status(201)),
      error: [missingSchema, refusalSchema],
    }),
  )
  .add(
    HttpApiEndpoint.post('drop', '/api/threads/:id/drops', {
      query: uploadQuery,
      params: id,
      payload: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array({ contentType: 'application/octet-stream' })),
      success: Schema.Struct({ path: Schema.String }).pipe(HttpApiSchema.status(201)),
      error: [missingSchema, refusalSchema],
    }),
  )
  .add(
    HttpApiEndpoint.get('attachment', '/api/threads/:id/attachments/:attachmentId', {
      query: lensQuery,
      params: Schema.Struct({ id: Schema.String, attachmentId: Schema.String }),
      error: [missingSchema, refusalSchema],
    }),
  );
