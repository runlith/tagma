import { Effect } from 'effect';
import type { BlockRows } from '../acts/rows.js';
import type { BlockNames } from '../contract/service/acts.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';

export type RetiredAct = string;

export const assertStanding = Effect.fnUntraced(function* (
  rows: BlockRows['Service'],
  names: BlockNames['Service'],
  id: number,
  attempt: RetiredAct,
) {
  const successor = yield* rows.successorOf(id);
  if (successor === null) return;
  const name = yield* names.nameOf(id);
  const heir = yield* names.nameOf(successor);
  return yield* new GateRefusal('superseded', `${name} was replaced by ${heir}, so it cannot ${attempt}`, [
    `read_block ${heir} — the block that stands in its place`,
    `read_block ${name} — the replaced block, which stays readable as history`,
  ]);
});
