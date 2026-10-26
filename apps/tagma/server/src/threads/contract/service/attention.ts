import { Context, type Stream } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { AttentionRow } from '../wire/attention.js';
import type { HarnessFailure } from './failure.js';

export type AttentionChange =
  | { readonly _tag: 'all'; readonly rows: readonly AttentionRow[] }
  | { readonly _tag: 'put'; readonly row: AttentionRow }
  | { readonly _tag: 'gone'; readonly threadId: string };

export class Attention extends Context.Service<
  Attention,
  {
    readonly changes: Stream.Stream<AttentionChange, HarnessFailure | StoreFailure>;
  }
>()('tagma/threads/Attention') {}
