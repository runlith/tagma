import { Context, type Effect } from 'effect';
import type { ThreadStorageFailed } from '@runlith/agent/thread/persisted';

export class OwnWork extends Context.Service<
  OwnWork,
  {
    readonly owing: (threads?: readonly string[]) => Effect.Effect<readonly string[], ThreadStorageFailed>;
    readonly endings: ReadonlySet<string>;
  }
>()('tagma/threads/OwnWork') {}
