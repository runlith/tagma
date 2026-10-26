export type ThreadKeptReason =
  | 'no-facet'
  | 'running'
  | 'in-use'
  | 'unarchived'
  | 'evicted'
  | 'no-file'
  | 'unreadable'
  | 'torn'
  | 'cursor-behind'
  | 'records-missing'
  | 'records-unreadable'
  | 'based'
  | 'referenced';

export type ThreadEvictionVerdict =
  | { readonly outcome: 'evicted'; readonly freedPages: number }
  | { readonly outcome: 'kept'; readonly reason: ThreadKeptReason };

export type ThreadKept = { readonly threadId: string; readonly reason: ThreadKeptReason };

export type ThreadSweep = {
  readonly evicted: readonly string[];
  readonly kept: readonly ThreadKept[];
  readonly off: readonly number[];
  readonly remaining: number;
};
