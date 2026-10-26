import { Effect } from 'effect';
import { body, pair } from '../../platform/contract/service/body.js';
import { revertThreadLines } from '../contract/service/threadLines.js';
import { CHANGE_WRITES as OPS } from '../contract/wire/writes.js';

export const revertLines = pair(
  OPS.revert_lines,
  body(OPS.revert_lines, {
    execute: Effect.fnUntraced(function* (input) {
      return { status: 'reverted' as const, result: yield* revertThreadLines(input) };
    }),
  }),
);
