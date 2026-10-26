import { Schema } from 'effect';
import { contractIdSchema } from './behaviour.js';

export const tagMoveSchema = Schema.Struct({
  field: Schema.String,
  to: Schema.String,
  from: Schema.optional(Schema.Array(Schema.String)),
  op: Schema.String,
  says: Schema.optional(Schema.String),
  label: Schema.optional(Schema.String),
});
export type TagMove = typeof tagMoveSchema.Type;

export const operatedSlotSchema = Schema.Struct({ field: Schema.String, ops: Schema.Array(Schema.String) });
export type OperatedSlot = typeof operatedSlotSchema.Type;

export const offeredOpsSchema = Schema.Struct({ contract: contractIdSchema, ops: Schema.Array(Schema.String) });

export const tagActionsSchema = Schema.Struct({
  moves: Schema.Array(tagMoveSchema),
  slots: Schema.Array(operatedSlotSchema),
  offers: Schema.Array(offeredOpsSchema),
});
export type TagActions = typeof tagActionsSchema.Type;

export const nodeActionsSchema = Schema.Struct({ ...tagActionsSchema.fields, revision: Schema.String });
export type NodeActions = typeof nodeActionsSchema.Type;

export const NO_ACTIONS: TagActions = { moves: [], slots: [], offers: [] };

export function moveOwners(actions: TagActions, field: string, from: string | null, to: string): readonly TagMove[] {
  return actions.moves.filter(
    (move) => move.field === field && move.to === to && (move.from === undefined || (from !== null && move.from.includes(from))),
  );
}
