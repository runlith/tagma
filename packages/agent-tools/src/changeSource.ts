import type { Effect } from 'effect';

export type Heard = { readonly from: number; readonly to: number };

export type ChangedPath = { readonly path: string; readonly heard: Heard | null };

export type ChangeSource = {
  readonly hold: (root: string) => Effect.Effect<() => void>;
  readonly settle: (root: string) => Effect.Effect<boolean>;
  readonly mark: (root: string) => Effect.Effect<string | null>;
  readonly changedSince: (root: string, position: string) => Effect.Effect<readonly ChangedPath[] | null>;
  readonly rulesMoved: (root: string) => Effect.Effect<void>;
};
