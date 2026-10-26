import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { Effect, FileSystem, Stream } from 'effect';
import { body, pair } from '../platform/contract/service/body.js';
import type { Caller } from '../platform/contract/wire/caller.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { Render } from './contract/service/render.js';
import { ArtifactStore } from './contract/service/shelf.js';
import { ARTIFACT_OPERATIONS as OPS, FRAME_WIDTH } from './contract/wire/operations.js';
import { TIMELINE_DECLARATION } from './contract/wire/fragment.js';
import { frameCount, frameTime } from './contract/wire/timeline.js';

type Asked = (typeof OPS.read_artifact_frames.input)['Type'];

const unnamed = (reason: string) =>
  new GateRefusal('page-unnamed', reason, ['name the page by `path`, or by `page` with an optional `version`']);

const pngSize = (bytes: Uint8Array) => {
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: header.getUint32(16), height: header.getUint32(20) };
};

const drawn = Effect.fnUntraced(function* (asked: Asked, caller: Caller) {
  const store = yield* ArtifactStore;
  if (asked.path !== undefined) {
    if (asked.page !== undefined || asked.version !== undefined)
      return yield* unnamed('`path` names a file, so `page` and `version` stay unset');
    const at = isAbsolute(asked.path) ? asked.path : caller.files?.resolve(asked.path);
    if (at === undefined)
      return yield* unnamed(`${asked.path} is relative and this call has no scratch to read it from; name it by its absolute path`);
    const draft = yield* store.draft(at);
    return { id: draft.id, version: null, html: draft.html, timeline: draft.timeline, problem: draft.timelineProblem };
  }
  if (asked.page === undefined) return yield* unnamed('neither `path` nor `page` names a page');
  const found = yield* store.page(asked.page, asked.version);
  if (found === null) {
    return yield* new GateRefusal(
      'artifact-unknown',
      asked.version === undefined
        ? `the shelf holds no page ${asked.page}`
        : `the shelf keeps no version ${asked.version} of page ${asked.page}`,
      ['list_artifacts — the pages on the shelf and their current versions'],
    );
  }
  return { id: found.record.id, version: found.record.version, html: found.html, timeline: found.record.timeline, problem: null };
});

export const FRAME_PAIRS = {
  read_artifact_frames: pair(
    OPS.read_artifact_frames,
    body(OPS.read_artifact_frames, {
      execute: Effect.fnUntraced(function* (asked, _prepared, caller) {
        const page = yield* drawn(asked, caller);
        const timeline = page.timeline;
        if (timeline === null) {
          return yield* new GateRefusal(
            'no-timeline',
            page.problem === null ? `page ${page.id} declares no timeline` : `page ${page.id} declares no usable timeline: ${page.problem}`,
            [`declare the timeline in the page, as ${TIMELINE_DECLARATION}`],
          );
        }
        const frames = frameCount(timeline);
        const outside = asked.frames.filter((k: number) => k >= frames);
        if (outside.length > 0) {
          return yield* new GateRefusal(
            'frame-out-of-range',
            `the timeline holds frames 0 to ${frames - 1}, so ${outside.join(', ')} ${outside.length === 1 ? 'is' : 'are'} past its end`,
            [`ask for frames from 0 to ${frames - 1}`],
          );
        }
        const shots = yield* (yield* Render)
          .frames({
            html: page.html,
            timeline,
            frames: asked.frames,
            scale: Math.min(1, FRAME_WIDTH / timeline.width),
            image: { format: 'png' },
            targets: 1,
          })
          .pipe(Stream.runCollect);
        const files = yield* FileSystem.FileSystem;
        const scratch = caller.actor.kind === 'thread' ? caller.files : null;
        const kept = join(scratch?.path ?? join(tmpdir(), 'tagma'), 'frames', page.id, page.version ?? 'draft');
        yield* files.makeDirectory(kept, { recursive: true }).pipe(Effect.orDie);
        const written = yield* Effect.forEach(shots, (shot) => {
          const path = join(kept, `${shot.k}.png`);
          return Effect.as(files.writeFile(path, shot.bytes).pipe(Effect.orDie), {
            k: shot.k,
            t: frameTime(timeline, shot.k),
            path,
            ...pngSize(shot.bytes),
          });
        });
        return { status: 'drawn' as const, id: page.id, version: page.version, timeline, frames: written };
      }),
      media: (answer) =>
        Effect.flatMap(FileSystem.FileSystem, (files) =>
          Effect.forEach(answer.frames, (frame) =>
            Effect.map(files.readFile(frame.path), (bytes) => ({
              bytes,
              mediaType: 'image/png',
              label: `frame ${frame.k} at ${frame.t} s`,
            })),
          ),
        ).pipe(Effect.orDie),
    }),
  ),
};
