import { Effect } from 'effect';
import { GraphScopes } from '../../graph/contract/service/serving.js';
import { HttpServerResponse } from 'effect/http';
import { HttpApiBuilder } from 'effect/http-api';
import { THREAD_ATTACHMENT_MEDIA_TYPES } from '@runlith/agent/transcript/attachments';
import { Attachments } from '../../threads/contract/service/attachments.js';
import { harnessRefusal } from '../../threads/refusals.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { Api } from '../../http/contract/wire/Api.js';
import { scopedLens } from './caller.js';
import { answering } from './answering.js';

export const threadsHandler = () =>
  HttpApiBuilder.group(
    Api,
    'threads',
    Effect.fn(function* (handlers) {
      const attachments = yield* Attachments;
      const scopes = yield* GraphScopes;
      const project = Effect.map(scopedLens(scopes), (lens) => lens.projectId);
      return handlers
        .handle('upload', ({ params, payload, headers, query }) =>
          answering(
            harnessRefusal(
              Effect.gen(function* () {
                const declared = headers['content-type']?.split(';')[0]?.trim();
                const mediaType = THREAD_ATTACHMENT_MEDIA_TYPES.find((candidate) => candidate === declared);
                if (!mediaType) {
                  return yield* new GateRefusal('unsupported-media-type', 'a thread attachment is an image, a markdown document or a PDF', [
                    ...THREAD_ATTACHMENT_MEDIA_TYPES,
                  ]);
                }
                const projectId = yield* project;
                return yield* attachments.upload(params.id, projectId, {
                  mediaType,
                  bytes: payload,
                  name: query.name,
                });
              }),
            ).pipe(Effect.catchTag('BodyMissing', (body) => Effect.fail(new GateRefusal('not-found', body.reason, body.unblock)))),
          ),
        )
        .handle('drop', ({ params, payload, query }) =>
          answering(
            harnessRefusal(
              Effect.gen(function* () {
                const projectId = yield* project;
                return { path: yield* attachments.drop(params.id, projectId, { bytes: payload, name: query.name }) };
              }),
            ).pipe(Effect.catchTag('BodyMissing', (body) => Effect.fail(new GateRefusal('not-found', body.reason, body.unblock)))),
          ),
        )
        .handle('attachment', ({ params }) =>
          answering(
            harnessRefusal(
              Effect.map(
                Effect.flatMap(project, (projectId) => attachments.read(params.id, projectId, params.attachmentId)),
                (attachment) =>
                  HttpServerResponse.uint8Array(attachment.bytes, {
                    headers: {
                      'content-type': attachment.mediaType,
                      'cache-control': 'private, max-age=31536000, immutable',
                      'x-content-type-options': 'nosniff',
                      ...(attachment.name === undefined
                        ? {}
                        : { 'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(attachment.name)}` }),
                    },
                  }),
              ),
            ).pipe(Effect.catchTag('BodyMissing', (body) => Effect.fail(new GateRefusal('not-found', body.reason, body.unblock)))),
          ),
        );
    }),
  );
