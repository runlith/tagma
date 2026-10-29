import { Effect, FileSystem } from 'effect';
import { GraphScopes } from '../../graph/contract/service/serving.js';
import { HttpServerResponse } from 'effect/http';
import { HttpApiBuilder } from 'effect/http-api';
import { Api } from '../../http/contract/wire/Api.js';
import { authorshipRefusal } from '../../change-record/threadFiles/failures.js';
import { readPicture } from '../../workspace/checkouts/picture.js';
import type { FileRoots } from '../../workspace/contract/service/roots.js';
import type { Git } from '@runlith/git/Git';
import { scopedLens } from './caller.js';
import type { CheckoutPlaces } from '../../workspace/contract/service/checkouts.js';
import { answering } from './answering.js';
import { CurrentCaller } from '../../invocation/contract/service/admission.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { entryAt } from '../../checkout-files/entry.js';
import { PREVIEW_BYTES } from '../../checkout-files/contract/wire/place.js';
import { rangedFile } from './ranged.js';

const COMMIT_END = /^[0-9a-f]{40}(?:[0-9a-f]{24})?\^?$/;

export const checkoutsHandler = (
  places: CheckoutPlaces['Service'],
  pictureDeps: { readonly roots: FileRoots['Service']; readonly git: Git['Service'] },
) =>
  HttpApiBuilder.group(
    Api,
    'checkouts',
    Effect.fn(function* (handlers) {
      const scopes = yield* GraphScopes;
      return handlers
        .handle('preview', ({ query, headers }) =>
          answering(
            Effect.gen(function* () {
              if ((yield* CurrentCaller).actor.kind !== 'operator') {
                return yield* new GateRefusal('operator-only', 'File previews are read by the operator.', [
                  'Open the file in the application.',
                ]);
              }
              const file = yield* entryAt(query.path);
              if (file?.kind !== 'file') return HttpServerResponse.empty({ status: 404 });
              if (query.save !== undefined)
                return HttpServerResponse.fromWeb(
                  new Response(Bun.file(file.path), {
                    headers: {
                      'content-type': 'application/octet-stream',
                      'content-length': String(file.bytes),
                      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(query.save)}`,
                      'cache-control': 'no-store',
                      'x-content-type-options': 'nosniff',
                    },
                  }),
                );
              const media = file.mediaType;
              const source = Bun.file(file.path);
              if (media.startsWith('video/'))
                return rangedFile(source, file.bytes, headers.range, {
                  'content-type': media,
                  'cache-control': 'no-store',
                  'x-content-type-options': 'nosniff',
                });
              const visual = media.startsWith('image/') || media === 'application/pdf';
              return HttpServerResponse.fromWeb(
                new Response(query.full === 'true' || visual ? source : source.slice(0, PREVIEW_BYTES), {
                  headers: {
                    'content-type': visual ? media : 'text/plain; charset=utf-8',
                    'cache-control': 'no-store',
                    'x-content-type-options': 'nosniff',
                    'content-security-policy': "default-src 'none'; sandbox",
                  },
                }),
              );
            }),
          ),
        )
        .handle('picture', ({ params, query }) =>
          answering(
            Effect.gen(function* () {
              const lens = yield* scopedLens(scopes);
              const rootId = yield* places.rootOf({ projectId: lens.projectId, cwd: undefined }, params.rootId);
              const picture = yield* Effect.mapError(
                readPicture(pictureDeps.roots, pictureDeps.git, yield* FileSystem.FileSystem, rootId, query.path, query.at),
                authorshipRefusal,
              );
              return HttpServerResponse.uint8Array(picture.bytes, {
                headers: {
                  'content-type': picture.mediaType,
                  'cache-control': COMMIT_END.test(query.at) ? 'private, max-age=31536000, immutable' : 'no-store',
                  'x-content-type-options': 'nosniff',
                  ...(picture.mediaType === 'image/svg+xml'
                    ? { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" }
                    : {}),
                },
              });
            }),
          ),
        );
    }),
  );
