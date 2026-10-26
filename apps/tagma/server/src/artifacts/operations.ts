import { pageRows } from '@runlith/paging';
import { Effect } from 'effect';
import { body, pair } from '../platform/contract/service/body.js';
import { ceilingOf } from '../platform/contract/wire/pageFamily.js';
import { ArtifactStore } from './contract/service/shelf.js';
import { readShelfCursor, shelfCursor } from './cursor.js';
import { FRAME_PAIRS } from './frames.js';
import { VIDEO_PAIRS } from './video.js';
import type { ArtifactRecord } from './contract/wire/artifacts.js';
import { ARTIFACT_OPERATIONS as OPS, ARTIFACT_ROWS } from './contract/wire/operations.js';

const CEILING = ceilingOf(ARTIFACT_ROWS);
const PAGE_BYTES = CEILING * ARTIFACT_ROWS.rowBytes.json;

const fitting = (rows: readonly { readonly record: ArtifactRecord }[]): number => {
  let spent = 0;
  let fitted = 0;
  for (const row of rows) {
    spent += Buffer.byteLength(JSON.stringify(row.record));
    if (fitted > 0 && spent > PAGE_BYTES) break;
    fitted += 1;
  }
  return fitted;
};

export const ARTIFACT_PAIRS = {
  ...FRAME_PAIRS,
  ...VIDEO_PAIRS,
  list_artifacts: pair(
    OPS.list_artifacts,
    body(OPS.list_artifacts, {
      execute: Effect.fnUntraced(function* (input) {
        const after = yield* readShelfCursor(input.cursor);
        const shelf = yield* (yield* ArtifactStore).list({
          limit: pageRows(input.limit, ARTIFACT_ROWS, CEILING),
          after: after ?? undefined,
        });
        const shown = shelf.rows.slice(0, fitting(shelf.rows));
        const last = shown[shown.length - 1];
        const next = last !== undefined && (shelf.more || shown.length < shelf.rows.length) ? shelfCursor(last.key) : null;
        return {
          status: 'listed' as const,
          artifacts: shown.map((row) => row.record),
          shown: shown.length,
          total: shelf.total,
          next,
          complete: true,
        };
      }),
    }),
  ),
};
