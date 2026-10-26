import type { WorkOrigin } from '../../../workspace/contract/wire/place.js';

export type ReshapeMode = '100644' | '100755';

export type Reshaped = {
  readonly path: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly mode?: ReshapeMode;
};

export type ReshapeRead =
  | { readonly kind: 'text'; readonly before: string | null; readonly after: string | null; readonly disk: string | null }
  | { readonly kind: 'binary' }
  | { readonly kind: 'outside' }
  | { readonly kind: 'unread'; readonly cause: string };

export type ReshapeInput = Reshaped & { readonly read: ReshapeRead };

export type ReshapeKept = 'conflict' | 'moved' | 'unreadable';

export type ReshapeOutcome =
  | { readonly _tag: 'merged'; readonly path: string }
  | { readonly _tag: 'unrecorded'; readonly path: string }
  | { readonly _tag: 'kept'; readonly path: string; readonly why: ReshapeKept; readonly owed: boolean };

export type DebtSource = 'steps' | 'post-commit';

export type ReshapeOwing = { readonly commit: string; readonly source: DebtSource };

export type ReshapeHolder = { readonly _tag: 'unheld' } | { readonly _tag: 'held'; readonly work: WorkOrigin };
