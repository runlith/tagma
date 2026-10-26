import { Effect } from 'effect';
import { startingRun } from '@runlith/agent/protocol/realtime';
import { body, type OperationPair, pair } from '../../platform/contract/service/body.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { CompactionChoices } from '../contract/service/compaction.js';
import { Compaction } from '../contract/service/context.js';
import { COMPACTION_OPERATIONS as OPS, type CompactionOperationId } from '../contract/wire/operations/compaction.js';
import { declaredRefusals } from '../../threads/refusalAnswers.js';

export const COMPACTION_PAIRS: { readonly [K in CompactionOperationId]: OperationPair<(typeof OPS)[K]> } = {
  read_compaction_summarizers: pair(
    OPS.read_compaction_summarizers,
    body(OPS.read_compaction_summarizers, {
      execute: Effect.fnUntraced(function* (input) {
        const call = yield* yield* CurrentProject;
        const chain = yield* (yield* CompactionChoices).chainAt(input.layer, call.project.id);
        return { status: 'read' as const, ...chain };
      }),
    }),
  ),
  compact_thread: pair(
    OPS.compact_thread,
    body(OPS.compact_thread, {
      execute: Effect.fnUntraced(function* ({ threadId, ...asked }) {
        const call = yield* yield* CurrentProject;
        return yield* startingRun((yield* Compaction).compact(threadId, call.project.id, asked));
      }, declaredRefusals(OPS.compact_thread)),
    }),
  ),
};
