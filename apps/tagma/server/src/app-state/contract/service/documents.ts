import { Context, type Effect, type Stream } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { AppDocument, AppStateEvent } from '../wire/documents.js';

type DocumentWrite = { readonly key: string; readonly value: string | null; readonly writer: string };

type DocumentSet = { readonly documents: readonly AppDocument[]; readonly revision: number };

export class Documents extends Context.Service<
  Documents,
  {
    readonly read: Effect.Effect<DocumentSet, StoreFailure>;
    write(change: DocumentWrite): Effect.Effect<number, StoreFailure>;
    readonly changes: Stream.Stream<AppStateEvent>;
  }
>()('tagma/app-state/Documents') {}
