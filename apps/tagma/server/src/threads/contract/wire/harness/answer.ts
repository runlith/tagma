import { Schema } from 'effect';
import { HARNESS_ID_MAX } from '@runlith/tagma/adapter/harness';

const answerId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(HARNESS_ID_MAX));

export const harnessHeldAnswerSchema = Schema.Struct({
  turn: answerId,
  text: Schema.String,
  rootKey: answerId,
  at: answerId,
});
export type HarnessHeldAnswer = typeof harnessHeldAnswerSchema.Type;

export const harnessHeldSchema = Schema.Struct({
  session: answerId,
  entries: Schema.Array(harnessHeldAnswerSchema),
});
export type HarnessHeld = typeof harnessHeldSchema.Type;
