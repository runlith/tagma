import { Context, type Effect } from 'effect';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { Editor } from '../wire/operations.js';

export type Listing = { readonly editors: readonly Editor[]; readonly failure: string | null };

export type Target = { readonly root: string | null; readonly file: string; readonly line: number };

export type OpenRefusal = 'editor-missing' | 'editor-failed';

export class Editors extends Context.Service<
  Editors,
  {
    readonly list: Effect.Effect<Listing>;
    open(editor: string, target: Target): Effect.Effect<void, GateRefusal<OpenRefusal>>;
  }
>()('tagma/editors/Editors') {}
