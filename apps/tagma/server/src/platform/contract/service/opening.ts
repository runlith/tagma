import { Context, Effect } from 'effect';

export type OpeningStep =
  | { readonly phase: 'opening'; readonly path: string; readonly at: number; readonly pending: number }
  | {
      readonly phase: 'migration';
      readonly path: string;
      readonly at: number;
      readonly name: string;
      readonly index: number;
      readonly total: number;
    }
  | { readonly phase: 'opened'; readonly path: string; readonly at: number; readonly applied: number; readonly total: number };

export const StoreOpening = Context.Reference<(step: OpeningStep) => Effect.Effect<void>>('tagma/platform/StoreOpening', {
  defaultValue: () => () => Effect.void,
});
