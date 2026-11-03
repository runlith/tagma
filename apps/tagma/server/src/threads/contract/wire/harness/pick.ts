import { Schema } from 'effect';
import type { ThreadModelSelection } from '@runlith/agent/thread/record';
import type { ModelSwitches } from '@runlith/llm/models/description';

export type ModelPick = ThreadModelSelection & { readonly account: string | null; readonly switches: ModelSwitches };

export type ThreadPick = ModelPick & { readonly id: string };

export const PICK_ENTRY = 'model-pick';

export const PickEntry = Schema.Struct({
  type: Schema.Literal(PICK_ENTRY),
  id: Schema.NonEmptyString,
  provider: Schema.String,
  model: Schema.String,
  reasoning: Schema.NullOr(Schema.String),
  reason: Schema.String,
  occurredAt: Schema.String,
});
export type PickEntry = typeof PickEntry.Type;
