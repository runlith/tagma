import { Context, type Effect } from 'effect';

type LockHeld = { readonly _tag: 'Holders'; readonly pids: ReadonlyArray<number> } | { readonly _tag: 'Unread'; readonly detail: string };

export class LockHolders extends Context.Service<LockHolders, { readonly of: (file: string) => Effect.Effect<LockHeld> }>()(
  'tagma/installation/LockHolders',
) {}
