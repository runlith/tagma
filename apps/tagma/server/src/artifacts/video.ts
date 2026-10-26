import { Effect } from 'effect';
import { body, pair } from '../platform/contract/service/body.js';
import { Videos } from './contract/service/videos.js';
import { ARTIFACT_OPERATIONS as OPS } from './contract/wire/operations.js';

export const VIDEO_PAIRS = {
  export_artifact_video: pair(
    OPS.export_artifact_video,
    body(OPS.export_artifact_video, {
      execute: Effect.fnUntraced(function* (asked) {
        const exported = yield* (yield* Videos).export({ page: asked.page, version: asked.version, scale: asked.scale ?? 1 });
        return exported.path === null
          ? { status: 'exporting' as const, page: asked.page, video: exported.video }
          : { status: 'exported' as const, page: asked.page, video: exported.video, path: exported.path };
      }),
    }),
  ),
  cancel_artifact_video: pair(
    OPS.cancel_artifact_video,
    body(OPS.cancel_artifact_video, {
      execute: Effect.fnUntraced(function* (asked) {
        yield* (yield* Videos).cancel(asked.job);
        return { status: 'cancelled' as const, job: asked.job };
      }),
    }),
  ),
};
