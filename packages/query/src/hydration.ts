import {
  QueryClient,
  dehydrate,
  hydrate,
  type DefaultError,
  type DefaultedQueryObserverOptions,
  type DehydratedState,
  type DehydrateOptions,
  type QueryClientConfig,
  type QueryKey,
  type QueryObserverOptions,
} from '@tanstack/query-core';

export type CreateQueryClientOptions = QueryClientConfig & {
  isBrowser?: boolean;
};

class ServerQueryClient extends QueryClient {
  override defaultQueryOptions<
    TQueryFnData = unknown,
    TError = DefaultError,
    TData = TQueryFnData,
    TQueryData = TQueryFnData,
    TQueryKey extends QueryKey = QueryKey,
    TPageParam = never,
  >(
    options:
      | QueryObserverOptions<TQueryFnData, TError, TData, TQueryData, TQueryKey, TPageParam>
      | DefaultedQueryObserverOptions<TQueryFnData, TError, TData, TQueryData, TQueryKey>,
  ): DefaultedQueryObserverOptions<TQueryFnData, TError, TData, TQueryData, TQueryKey> {
    const defaulted = super.defaultQueryOptions(options);
    if (defaulted.gcTime === Infinity) return defaulted;
    return { ...defaulted, gcTime: Infinity };
  }
}

export function createQueryClient(options?: CreateQueryClientOptions): QueryClient {
  const { isBrowser, defaultOptions, ...rest } = options ?? {};

  const queries = defaultOptions?.queries;
  const enabled = queries?.enabled ?? isBrowser;

  const nextDefaultOptions: QueryClientConfig['defaultOptions'] | undefined =
    enabled === undefined && defaultOptions === undefined
      ? undefined
      : {
          ...defaultOptions,
          queries: enabled === undefined ? queries : { ...queries, enabled },
        };

  const config = { ...rest, defaultOptions: nextDefaultOptions };
  return isBrowser === false ? new ServerQueryClient(config) : new QueryClient(config);
}

export function dehydrateQueryClient(queryClient: QueryClient, options?: DehydrateOptions): DehydratedState {
  return dehydrate(queryClient, options);
}

export function hydrateQueryClient(queryClient: QueryClient, state: DehydratedState): void {
  hydrate(queryClient, state);
}
