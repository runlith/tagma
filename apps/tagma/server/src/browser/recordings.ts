import { Effect } from 'effect';
import { body, type OperationPair, pair } from '../platform/contract/service/body.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { Recordings } from './contract/service/recordings.js';
import { RECORD_OPERATIONS as RECORD, type RecordOperationId } from './contract/wire/recordOperations.js';
import { RECORDING_FPS } from './contract/wire/recording.js';
import { pageOf, threadOf } from './operations.js';

export const RECORD_PAIRS: { readonly [K in RecordOperationId]: OperationPair<(typeof RECORD)[K]> } = {
  record_page: pair(
    RECORD.record_page,
    body(RECORD.record_page, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const recordings = yield* Recordings;
        const thread = threadOf(caller);
        const named = input.page;
        const closed = (refused: GateRefusal<'page-unknown'>) =>
          input.action === 'stop' && named !== undefined && thread !== null
            ? Effect.flatMap(recordings.kept(named, thread), (kept) =>
                kept === undefined ? Effect.fail(refused) : Effect.succeed({ kept }),
              )
            : Effect.fail(refused);
        const resolved = yield* pageOf(caller, named).pipe(
          Effect.catchIf(
            (failure): failure is GateRefusal<'page-unknown'> => failure instanceof GateRefusal && failure.code === 'page-unknown',
            closed,
          ),
        );
        if ('kept' in resolved) return { status: 'recorded' as const, ...resolved.kept };
        if (input.action === 'start')
          return { status: 'recording' as const, ...(yield* recordings.start(resolved.page, input.fps ?? RECORDING_FPS, thread)) };
        return { status: 'recorded' as const, ...(yield* recordings.stop(resolved.page, thread)) };
      }),
    }),
  ),
};
