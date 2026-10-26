import { Context, Schema } from 'effect';

export const rolloutReadSchema = Schema.Struct({ path: Schema.String, bytes: Schema.Int });
export type RolloutRead = typeof rolloutReadSchema.Type;
export type ReadRollout = (read: RolloutRead) => void;

export const totalledReads = (): { readonly observe: ReadRollout; readonly drain: () => readonly RolloutRead[] } => {
  const totals = new Map<string, number>();
  return {
    observe: ({ path, bytes }) => void totals.set(path, (totals.get(path) ?? 0) + bytes),
    drain: () => [...totals].map(([path, bytes]) => ({ path, bytes })),
  };
};

export const RolloutReads = Context.Reference<ReadRollout>('threads/RolloutReads', { defaultValue: () => () => undefined });
