import { Context, Data, type Effect } from 'effect';
import type { EditorEntry } from '../wire/catalog.js';

export type Launcher = { readonly program: string; readonly prefix: readonly string[] };

export type Command = { readonly program: string; readonly args: readonly string[] };

export type Sighting =
  | { readonly id: string; readonly found: 'installed'; readonly launcher: Launcher | null; readonly icon: string | null }
  | { readonly id: string; readonly found: 'absent' }
  | { readonly id: string; readonly found: 'failed'; readonly reason: string };

export class LookupFailed extends Data.TaggedError('LookupFailed')<{ readonly message: string }> {}

export class EditorHost extends Context.Service<
  EditorHost,
  {
    find(entries: readonly EditorEntry[]): Effect.Effect<readonly Sighting[], LookupFailed>;
    opener(url: string): Command;
  }
>()('tagma/editors/EditorHost') {}
