import type { DefaultError, FetchStatus, InfiniteData, QueryClient, QueryStatus } from '@tanstack/query-core';
import type { Scope } from '@runlith/layer/Scope';

export type RefetchType = 'active' | 'all' | 'none';

export type QueryInvalidateOptions = {
  refetchType?: RefetchType;
};

export type QueryLoadOptions = {
  refresh?: true;
  throwOnError?: boolean;
};

export type QueryKind = 'static' | 'page' | 'inf';

export type BaseQueryOptions = {
  staleTime?: number;
  gcTime?: number;
  retry?: number | boolean;
  refetchOnWindowFocus?: boolean;
  refetchOnReconnect?: boolean;
  refetchInterval?: number | false;
  enabled?: boolean;
  // Every query built from it — a key, a page, a feed — is observed from its first use to the end of its scope, reader or not, so `refetchInterval` and `refetchOnWindowFocus` run on their own.
  live?: boolean;
};

export type PageOptions<TPageParam = number> = {
  page: TPageParam;
  pageSize?: number;
};

export type InfOptions<TPageParam = number> = {
  pageSize?: number;
  initialPageParam?: TPageParam;
};

export type SingleLoaderContext<TPageParam = number> = {
  signal: AbortSignal;
  type: QueryKind;
  pageParam?: TPageParam;
  pageSize?: number;
};

export type KeyedLoaderContext<TKey, TPageParam = number> = SingleLoaderContext<TPageParam> & {
  key: TKey;
};

export type SingleQueryConfig<TData, TPageParam = number> = BaseQueryOptions & {
  name: string;
  scope: Scope;
  queryClient: QueryClient;
  loader: (context: SingleLoaderContext<TPageParam>) => Promise<TData>;
  initialPageParam?: TPageParam;
  getNextPageParam?: (lastPage: TData, allPages: TData[], lastPageParam: TPageParam) => TPageParam | undefined;
  getPreviousPageParam?: (firstPage: TData, allPages: TData[], firstPageParam: TPageParam) => TPageParam | undefined;
};

export type KeyedQueryConfig<TKey, TData, TPageParam = number> = BaseQueryOptions & {
  name: string;
  scope: Scope;
  queryClient: QueryClient;
  loader: (context: KeyedLoaderContext<TKey, TPageParam>) => Promise<TData>;
  initialPageParam?: TPageParam;
  getNextPageParam?: (lastPage: TData, allPages: TData[], lastPageParam: TPageParam) => TPageParam | undefined;
  getPreviousPageParam?: (firstPage: TData, allPages: TData[], firstPageParam: TPageParam) => TPageParam | undefined;
};

export type BaseQuery<TData, TError = DefaultError> = {
  load(options?: QueryLoadOptions): Promise<TData | undefined>;
  loadOrThrow(options?: Omit<QueryLoadOptions, 'throwOnError'>): Promise<TData | undefined>;
  refresh(options?: Omit<QueryLoadOptions, 'refresh'>): Promise<TData | undefined>;
  watch(): TData | undefined;
  watchError(): TError | undefined;
  watchFetching(): boolean;
  readonly promise: Promise<TData>;
  reset(): void;
  cancel(): Promise<void>;
  invalidate(options?: QueryInvalidateOptions): Promise<void>;
  setCache(valueOrUpdater: TData | ((prev: TData | undefined) => TData | undefined)): void;

  readonly data: TData | undefined;
  readonly error: TError | undefined;
  readonly isPending: boolean;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly isSuccess: boolean;
  readonly isError: boolean;
  readonly isStale: boolean;
  readonly status: QueryStatus;
  readonly fetchStatus: FetchStatus;
};

export type InfQuery<TData, TError = DefaultError, TPageParam = number> = BaseQuery<InfiniteData<TData, TPageParam>, TError> & {
  fetchNextPage(): Promise<void>;
  fetchPreviousPage(): Promise<void>;
  readonly hasNextPage: boolean;
  readonly hasPreviousPage: boolean;
  readonly isFetchingNextPage: boolean;
  readonly isFetchingPreviousPage: boolean;
};

export type SingleQuery<TData, TError = DefaultError, TPageParam = number> = BaseQuery<TData, TError> & {
  readonly name: string;
  page(options: PageOptions<TPageParam>): PageQuery<TData, TError, TPageParam>;
  inf(options?: InfOptions<TPageParam>): InfQuery<TData, TError, TPageParam>;
  all(): QueryGroup;
};

export type PageQuery<TData, TError = DefaultError, TPageParam = number> = BaseQuery<TData, TError> & {
  readonly page: TPageParam;
};

export type KeyQuery<TKey, TData, TError = DefaultError, TPageParam = number> = BaseQuery<TData, TError> & {
  readonly key: TKey;
  page(options: PageOptions<TPageParam>): PageQuery<TData, TError, TPageParam>;
  inf(options?: InfOptions<TPageParam>): InfQuery<TData, TError, TPageParam>;
};

export type QueryGroup = {
  reset(): void;
  cancel(): Promise<void>;
  invalidate(options?: QueryInvalidateOptions): Promise<void>;
};

export type QueryFamily<TKey, TData, TError = DefaultError, TPageParam = number> = {
  readonly name: string;
  key(key: TKey): KeyQuery<TKey, TData, TError, TPageParam>;
  all(): QueryGroup;
  where(match: (key: TKey) => boolean): QueryGroup;
  reset(): void;
};
