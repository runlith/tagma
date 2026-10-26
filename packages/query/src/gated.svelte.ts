import type { DefaultError, InfiniteData } from '@tanstack/query-core';

import type { BaseQuery, InfQuery, QueryInvalidateOptions, QueryLoadOptions } from './types.js';

type GatedFields<TData, TError> = {
  readonly isDisabled: boolean;
  readonly data: TData | undefined;
  readonly error: TError | undefined;
  readonly isPending: boolean;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly isSuccess: boolean;
  readonly isError: boolean;
  readonly isStale: boolean;
  load(options?: QueryLoadOptions): Promise<TData | undefined>;
  loadOrThrow(options?: Omit<QueryLoadOptions, 'throwOnError'>): Promise<TData | undefined>;
  refresh(options?: Omit<QueryLoadOptions, 'refresh'>): Promise<TData | undefined>;
  watch(): TData | undefined;
  watchError(): TError | undefined;
  invalidate(options?: QueryInvalidateOptions): Promise<void>;
  reset(): void;
};

export type GatedQuery<TData, TError = DefaultError> = GatedFields<TData, TError> & {
  readonly query: BaseQuery<TData, TError> | undefined;
};

export type GatedInfQuery<TData, TError = DefaultError, TPageParam = number> = GatedFields<InfiniteData<TData, TPageParam>, TError> & {
  readonly query: InfQuery<TData, TError, TPageParam> | undefined;
  readonly hasNextPage: boolean;
  readonly hasPreviousPage: boolean;
  readonly isFetchingNextPage: boolean;
  readonly isFetchingPreviousPage: boolean;
  fetchNextPage(): Promise<void>;
  fetchPreviousPage(): Promise<void>;
};

type AnyQuery = BaseQuery<unknown, unknown>;
type AnyInfQuery = InfQuery<unknown, unknown, unknown>;

function asInf(query: AnyQuery | undefined): AnyInfQuery | undefined {
  if (query !== undefined && 'fetchNextPage' in query) return query as AnyInfQuery;
  return undefined;
}

export function gated<TData, TError = DefaultError, TPageParam = number>(
  source: () => InfQuery<TData, TError, TPageParam> | undefined,
): GatedInfQuery<TData, TError, TPageParam>;
export function gated<TData, TError = DefaultError>(source: () => BaseQuery<TData, TError> | undefined): GatedQuery<TData, TError>;
export function gated(source: () => AnyQuery | undefined): GatedQuery<unknown, unknown> | GatedInfQuery<unknown, unknown, unknown> {
  const current = $derived.by(source);

  return {
    get query() {
      return current;
    },
    get isDisabled() {
      return current === undefined;
    },
    get data() {
      return current?.data as InfiniteData<unknown, unknown> | undefined;
    },
    get error() {
      return current?.error;
    },
    get isPending() {
      return current?.isPending ?? false;
    },
    get isLoading() {
      return current?.isLoading ?? false;
    },
    get isFetching() {
      return current?.isFetching ?? false;
    },
    get isSuccess() {
      return current?.isSuccess ?? false;
    },
    get isError() {
      return current?.isError ?? false;
    },
    get isStale() {
      return current?.isStale ?? false;
    },
    get hasNextPage() {
      return asInf(current)?.hasNextPage ?? false;
    },
    get hasPreviousPage() {
      return asInf(current)?.hasPreviousPage ?? false;
    },
    get isFetchingNextPage() {
      return asInf(current)?.isFetchingNextPage ?? false;
    },
    get isFetchingPreviousPage() {
      return asInf(current)?.isFetchingPreviousPage ?? false;
    },
    async load(...args: Parameters<BaseQuery<unknown>['load']>) {
      return (await current?.load(...args)) as InfiniteData<unknown, unknown> | undefined;
    },
    async loadOrThrow(...args: Parameters<BaseQuery<unknown>['loadOrThrow']>) {
      return (await current?.loadOrThrow(...args)) as InfiniteData<unknown, unknown> | undefined;
    },
    async refresh(...args: Parameters<BaseQuery<unknown>['refresh']>) {
      return (await current?.refresh(...args)) as InfiniteData<unknown, unknown> | undefined;
    },
    watch() {
      return current?.watch() as InfiniteData<unknown, unknown> | undefined;
    },
    watchError() {
      return current?.watchError();
    },
    async invalidate(...args: Parameters<BaseQuery<unknown>['invalidate']>) {
      await current?.invalidate(...args);
    },
    reset() {
      current?.reset();
    },
    async fetchNextPage() {
      await asInf(current)?.fetchNextPage();
    },
    async fetchPreviousPage() {
      await asInf(current)?.fetchPreviousPage();
    },
  };
}
