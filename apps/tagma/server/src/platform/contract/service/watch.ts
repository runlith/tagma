import { Context, Data, type Effect } from 'effect';

export class WatchTickets extends Context.Service<
  WatchTickets,
  {
    grant(): Effect.Effect<(() => void) | null>;
    standing(): { readonly budget: number; readonly active: number };
  }
>()('tagma/platform/WatchTickets') {}

export type WatchChange = {
  readonly kind: 'create' | 'update' | 'delete';
  readonly path: string;
  readonly directory?: boolean;
  readonly heard?: { readonly from: number; readonly to: number };
};

export type WatchHearing = {
  readonly heard: (changes: readonly WatchChange[]) => void;
  readonly dropped: (reason: string, subtree: string | null) => void;
  readonly ended: (reason: string) => void;
};

export type WatchOptions = { readonly recursive: boolean; readonly ignore: readonly string[] };

export type WatchSubscription = { readonly close: Effect.Effect<void> };

export class WatchRefused extends Data.TaggedError('WatchRefused')<{ readonly message: string }> {}

export class FileWatcher extends Context.Service<
  FileWatcher,
  {
    subscribe(at: string, options: WatchOptions, hearing: WatchHearing): Effect.Effect<WatchSubscription, WatchRefused>;
    mark(at: string, file: string | null, ignore: readonly string[], lasting: boolean): Effect.Effect<string, WatchRefused>;
    settle(at: string, ignore: readonly string[]): Effect.Effect<boolean, WatchRefused>;
    changedSince(at: string, position: string, ignore: readonly string[]): Effect.Effect<readonly WatchChange[] | null, WatchRefused>;
    readonly marking: 'refresh' | 'close';
    readonly heardLateMs: number;
  }
>()('tagma/platform/FileWatcher') {}
