import { Effect } from 'effect';
import type { OpOutcome } from '../contract/service/work.js';
import type { BlockRecord, BlockWrite } from '../contract/service/acts.js';
import { wireSource, wireBlock, wireWritten } from '../reading/rows.js';
import type { BatchOutcomeBody } from '../contract/wire/reports.js';

export const answerWritten = Effect.fn('wire.answerWritten')(function* (row: BlockRecord & Partial<BlockWrite>) {
  return wireWritten(row);
});

export function wireOutcome(outcome: OpOutcome): BatchOutcomeBody {
  if ('ok' in outcome) return { ok: true };
  if ('blockId' in outcome) return wireSource(outcome);
  const row = wireBlock(outcome);
  return {
    ...row,
    refsIn: 'refsIn' in outcome ? outcome.refsIn : undefined,
  };
}
