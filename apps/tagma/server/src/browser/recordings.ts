import { Effect } from 'effect';
import { body, type OperationPair, pair } from '../platform/contract/service/body.js';
import { Recordings } from './contract/service/recordings.js';
import { RECORD_OPERATIONS as RECORD, type RecordOperationId } from './contract/wire/recordOperations.js';
import { RECORDING_FPS } from './contract/wire/recording.js';
import { pageOf } from './operations.js';

export const RECORD_PAIRS: { readonly [K in RecordOperationId]: OperationPair<(typeof RECORD)[K]> } = {
  record_page: pair(
    RECORD.record_page,
    body(RECORD.record_page, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const { page, thread } = yield* pageOf(caller, input.page);
        const recordings = yield* Recordings;
        if (input.action === 'start')
          return { status: 'recording' as const, ...(yield* recordings.start(page, input.fps ?? RECORDING_FPS, thread)) };
        return { status: 'recorded' as const, ...(yield* recordings.stop(page, thread)) };
      }),
    }),
  ),
};
