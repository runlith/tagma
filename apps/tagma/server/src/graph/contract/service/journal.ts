import { Context, type Effect } from 'effect';
import type { PageSlice } from '@runlith/paging';
import type { SessionRow } from '../../../platform/contract/service/writers.js';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { graphFrameSchema } from '../wire/feed.js';
import type { GraphEventOp, JournalVocabulary } from '../wire/journal.js';
import type { ActEntry } from './acts.js';

export class GraphJournal extends Context.Service<
  GraphJournal,
  {
    events(filter?: {
      blockId?: number;
      sinceId?: number;
      beforeId?: number;
      until?: Date;
      limit?: number;
      projectId?: number;
      scopeId?: number;
      concerning?: number;
      tags?: readonly string[];
      sessions?: readonly number[];
      ops?: readonly string[];
    }): Effect.Effect<ActEntry[], StoreFailure>;
    vocabulary(filter: { projectId: number; scopeId?: number }): Effect.Effect<JournalVocabulary, StoreFailure>;
    writersIn(input: { projectId: number; before?: number; limit: number }): Effect.Effect<PageSlice<SessionRow, number>, StoreFailure>;
    newest(ids: readonly number[], ops: readonly GraphEventOp[]): Effect.Effect<ReadonlyMap<number, ActEntry>, StoreFailure>;
    byCall(callId: string, sessionId: number | null): Effect.Effect<ActEntry[], StoreFailure>;
    authors(ids: readonly number[]): Effect.Effect<ReadonlyMap<number, number | null>, StoreFailure>;
    touchedBy(sessionId: number, ids: readonly number[]): Effect.Effect<ReadonlySet<number>, StoreFailure>;
  }
>()('tagma/graph/GraphJournal') {}

export type GraphFrame = typeof graphFrameSchema.Type;

export class GraphFeed extends Context.Service<
  GraphFeed,
  {
    subscribe(projectId: number, listener: (frame: GraphFrame) => void): Effect.Effect<() => void>;
    flush(): Effect.Effect<void>;
  }
>()('tagma/graph/GraphFeed') {}
