import {
  InfiniteQueryObserver,
  type QueryClient,
  hashKey,
  isCancelledError,
  type DefaultError,
  type FetchInfiniteQueryOptions,
  type FetchStatus,
  type InfiniteData,
  type InfiniteQueryObserverOptions,
  type InfiniteQueryObserverResult,
  type QueryKey,
  type QueryStatus,
  isServer,
} from '@tanstack/query-core';
import type { Scope } from '@runlith/layer/Scope';

import { createSubscriber } from 'svelte/reactivity';

import { deliver } from './core/deliver.svelte.js';
import { defineHiddenGetters, fetchFresh, isAbortError, toUndefined } from './core/utils.js';
import type { BaseQueryOptions, InfQuery, QueryLoadOptions } from './types.js';

type InfiniteQueryConfig<TData, TPageParam> = {
  scope: Scope;
  queryClient: QueryClient;
  queryKey: QueryKey;
  queryFn: (context: { signal: AbortSignal; pageParam: TPageParam }) => Promise<TData>;
  options: BaseQueryOptions;
  initialPageParam: TPageParam;
  getNextPageParam?: (lastPage: TData, allPages: TData[], lastPageParam: TPageParam) => TPageParam | undefined;
  getPreviousPageParam?: (firstPage: TData, allPages: TData[], firstPageParam: TPageParam) => TPageParam | undefined;
};

export function createInfiniteQuery<TData, TError = DefaultError, TPageParam = number>(
  config: InfiniteQueryConfig<TData, TPageParam>,
): InfQuery<TData, TError, TPageParam> {
  const { scope, queryClient, queryKey } = config;

  let observer: InfiniteQueryObserver<TData, TError, InfiniteData<TData, TPageParam>, QueryKey, TPageParam> | undefined;
  let result: InfiniteQueryObserverResult<InfiniteData<TData, TPageParam>, TError> | undefined;
  let changed: (() => void) | undefined;
  let subscription: VoidFunction | undefined;
  let cacheSubscription: VoidFunction | undefined;
  let observationToken = 0;
  let observed = false;
  // A live query is its own reader in the browser from its first use to the end of its scope; a server render never polls.
  const live = config.options.live === true && !isServer;
  const isHeld = () => observed || live;
  let query: InfQuery<TData, TError, TPageParam>;

  const { staleTime, retry, gcTime } = config.options;

  const queryFn: InfiniteQueryObserverOptions<TData, TError, InfiniteData<TData, TPageParam>, QueryKey, TPageParam>['queryFn'] = async ({
    signal,
    pageParam,
  }) => {
    return await config.queryFn({ signal, pageParam: pageParam as TPageParam });
  };

  const getNextPageParam: NonNullable<
    InfiniteQueryObserverOptions<TData, TError, InfiniteData<TData, TPageParam>, QueryKey, TPageParam>['getNextPageParam']
  > = (lastPage, allPages, lastPageParam) => {
    return config.getNextPageParam?.(lastPage, allPages, lastPageParam);
  };

  const getPreviousPageParam: InfiniteQueryObserverOptions<
    TData,
    TError,
    InfiniteData<TData, TPageParam>,
    QueryKey,
    TPageParam
  >['getPreviousPageParam'] = config.getPreviousPageParam
    ? (firstPage, allPages, firstPageParam) => {
        return config.getPreviousPageParam?.(firstPage, allPages, firstPageParam);
      }
    : undefined;

  const paginationOptions = {
    initialPageParam: config.initialPageParam,
    getNextPageParam,
    getPreviousPageParam,
  };

  const observerOptions: InfiniteQueryObserverOptions<TData, TError, InfiniteData<TData, TPageParam>, QueryKey, TPageParam> = {
    ...paginationOptions,
    queryKey,
    queryFn,
    ...(gcTime === undefined ? {} : { gcTime }),
    ...(config.options.refetchOnWindowFocus === undefined ? {} : { refetchOnWindowFocus: config.options.refetchOnWindowFocus }),
    ...(config.options.refetchOnReconnect === undefined ? {} : { refetchOnReconnect: config.options.refetchOnReconnect }),
    ...(config.options.enabled === undefined ? {} : { enabled: config.options.enabled }),
    ...(staleTime === undefined ? {} : { staleTime }),
    ...(retry === undefined ? {} : { retry }),
    ...(config.options.refetchInterval === undefined ? {} : { refetchInterval: config.options.refetchInterval }),
  };

  const sync = (current = observer) => {
    if (!current || current !== observer) return;
    result = current.getCurrentResult();
    changed?.();
  };

  const view = () => {
    if (result) {
      return {
        data: result.data,
        error: result.error,
        status: result.status,
        fetchStatus: result.fetchStatus,
        isStale: result.isStale,
        hasNextPage: result.hasNextPage,
        hasPreviousPage: result.hasPreviousPage,
        isFetchingNextPage: result.isFetchingNextPage,
        isFetchingPreviousPage: result.isFetchingPreviousPage,
      };
    }

    const query = queryClient.getQueryCache().find<InfiniteData<TData, TPageParam>, TError>({ queryKey, exact: true });

    const data = query?.state.data;
    const pages = data?.pages;
    const pageParams = data?.pageParams;

    const lastPageParam = pageParams?.[pageParams.length - 1];
    const firstPageParam = pageParams?.[0];

    return {
      data,
      error: query?.state.error ?? null,
      status: query?.state.status ?? ('pending' as QueryStatus),
      fetchStatus: query?.state.fetchStatus ?? ('idle' as FetchStatus),
      isStale: query?.isStale() ?? true,
      hasNextPage:
        pages !== undefined && lastPageParam !== undefined
          ? config.getNextPageParam?.(pages[pages.length - 1]!, pages, lastPageParam) !== undefined
          : false,
      hasPreviousPage:
        pages !== undefined && firstPageParam !== undefined
          ? config.getPreviousPageParam?.(pages[0]!, pages, firstPageParam) !== undefined
          : false,
      isFetchingNextPage: false,
      isFetchingPreviousPage: false,
    };
  };

  const scheduleSync = (current = observer) => {
    if (!current) return;
    queueMicrotask(() => sync(current));
  };

  const ensureObserver = () => {
    if (scope.closed) return undefined;

    if (!observer) {
      observer = new InfiniteQueryObserver<TData, TError, InfiniteData<TData, TPageParam>, QueryKey, TPageParam>(
        queryClient,
        observerOptions,
      );
    } else {
      observer.setOptions(observerOptions);
    }

    sync(observer);
    return observer;
  };

  const queryHash = hashKey(queryKey);
  const pending = () => queryClient.getQueryCache().get<InfiniteData<TData, TPageParam>, TError>(queryHash)?.promise;

  const buildFetchOptions = (options?: QueryLoadOptions): FetchInfiniteQueryOptions<TData, TError, TData, QueryKey, TPageParam> => {
    const resolvedStaleTime = options?.refresh === true ? 0 : staleTime;

    return {
      ...paginationOptions,
      queryKey,
      queryFn,
      ...(gcTime === undefined ? {} : { gcTime }),
      ...(resolvedStaleTime === undefined ? {} : { staleTime: resolvedStaleTime }),
      ...(retry === undefined ? {} : { retry }),
    };
  };

  const releaseObserver = () => {
    observationToken += 1;
    subscription?.();
    subscription = undefined;
    cacheSubscription?.();
    cacheSubscription = undefined;
    observer?.destroy();
    observer = undefined;
    result = undefined;
    changed?.();
  };

  const startObservation = () => {
    observationToken += 1;
    const current = ensureObserver();
    if (!current) return;

    if (!subscription) {
      subscription = current.subscribe(() => scheduleSync(current));
      cacheSubscription = queryClient.getQueryCache().subscribe((event) => {
        if (event.type !== 'removed') return;
        if (event.query.queryHash !== current.getCurrentQuery().queryHash) return;

        queueMicrotask(() => {
          if (scope.closed || !isHeld() || observer !== current) return;
          current.setOptions(observerOptions);
          sync(current);
        });
      });
    }

    scheduleSync(current);
  };

  const stopObservation = () => {
    const current = observer;
    const token = ++observationToken;
    const inFlight = current?.getCurrentQuery().promise;
    if (inFlight) {
      queryClient.mount();
      void inFlight.finally(() => queryClient.unmount()).catch(() => undefined);
    }

    queueMicrotask(() => {
      if (scope.closed || isHeld() || observationToken !== token || observer !== current) return;

      if (inFlight) {
        void inFlight
          .finally(() => {
            queueMicrotask(() => {
              if (scope.closed || isHeld() || observationToken !== token || observer !== current) return;
              releaseObserver();
            });
          })
          .catch(() => undefined);
        return;
      }

      releaseObserver();
    });
  };

  const cacheVersion = createSubscriber((update) => {
    const hash = hashKey(queryKey);
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.query.queryHash === hash) deliver(update);
    });
  });

  const autoAttach = createSubscriber((update) => {
    changed = update;
    observed = true;
    queryClient.mount();
    startObservation();
    return () => {
      changed = undefined;
      observed = false;
      queryClient.unmount();
      stopObservation();
    };
  });

  const fetchAndSync = async (options?: QueryLoadOptions): Promise<InfiniteData<TData, TPageParam> | undefined> => {
    if (scope.closed) return undefined;

    const throwOnError = options?.throwOnError ?? false;
    queryClient.mount();

    try {
      const value = await fetchFresh(queryClient, queryKey, options?.refresh === true, () =>
        queryClient.fetchInfiniteQuery(buildFetchOptions(options)),
      );
      if (observer) {
        observer.setOptions(observerOptions);
        sync(observer);
      }
      return value;
    } catch (error) {
      if (observer) {
        observer.setOptions(observerOptions);
        sync(observer);
      }

      if (isCancelledError(error) || isAbortError(error)) return undefined;
      if (throwOnError) throw error;
      return undefined;
    } finally {
      queryClient.unmount();
    }
  };

  type QueryCore = Omit<
    InfQuery<TData, TError, TPageParam>,
    | 'hasNextPage'
    | 'hasPreviousPage'
    | 'isFetchingNextPage'
    | 'isFetchingPreviousPage'
    | 'data'
    | 'error'
    | 'isPending'
    | 'isLoading'
    | 'isFetching'
    | 'isSuccess'
    | 'isError'
    | 'isStale'
    | 'promise'
    | 'status'
    | 'fetchStatus'
  >;

  const queryCore = {
    async load(options) {
      return await fetchAndSync(options);
    },
    async loadOrThrow(options?: Omit<QueryLoadOptions, 'throwOnError'>) {
      return await fetchAndSync({ ...options, throwOnError: true });
    },
    async refresh(options?: Omit<QueryLoadOptions, 'refresh'>) {
      return await fetchAndSync({ refresh: true, ...options });
    },
    watchError() {
      cacheVersion();
      return toUndefined(queryClient.getQueryState(queryKey)?.error) as TError | undefined;
    },
    watchFetching() {
      cacheVersion();
      return queryClient.getQueryState(queryKey)?.fetchStatus === 'fetching';
    },
    watch() {
      cacheVersion();
      return queryClient.getQueryData(queryKey) as InfiniteData<TData, TPageParam> | undefined;
    },
    reset() {
      if (scope.closed) return;
      void queryClient.cancelQueries({ queryKey, exact: true }).catch(() => undefined);
      queryClient.removeQueries({ queryKey, exact: true });
      if (observer) {
        observer.setOptions(observerOptions);
        sync(observer);
      }
    },
    async cancel() {
      if (scope.closed) return;
      await queryClient.cancelQueries({ queryKey, exact: true }).catch(() => undefined);
    },
    async invalidate(options) {
      if (scope.closed) return;
      await queryClient.invalidateQueries({ queryKey, exact: true, refetchType: options?.refetchType }).catch(() => undefined);
    },
    setCache(valueOrUpdater) {
      if (scope.closed) return;
      queryClient.setQueryData(queryKey, valueOrUpdater);
      if (observer) {
        observer.setOptions(observerOptions);
        sync(observer);
      }
    },

    async fetchNextPage() {
      if (scope.closed) return;
      ensureObserved();
      await ensureObserver()
        ?.fetchNextPage()
        .catch(() => undefined);
    },
    async fetchPreviousPage() {
      if (scope.closed) return;
      ensureObserved();
      await ensureObserver()
        ?.fetchPreviousPage()
        .catch(() => undefined);
    },
  } satisfies QueryCore;

  query = queryCore as InfQuery<TData, TError, TPageParam>;

  scope.defer(() => {
    releaseObserver();
    queryClient.removeQueries({ queryKey, exact: true });
  });

  if (live && !scope.closed) {
    queryClient.mount();
    scope.defer(() => queryClient.unmount());
    startObservation();
  }

  const ensureObserved = () => {
    if (scope.closed) return;
    autoAttach();
  };

  defineHiddenGetters(query, {
    promise: () => {
      scope.assertOpen();
      autoAttach();

      const held = pending();
      if (held) return held;

      const fetchPromise = queryClient.fetchInfiniteQuery(buildFetchOptions());
      return pending() ?? fetchPromise;
    },
    hasNextPage: () => {
      ensureObserved();
      return view().hasNextPage;
    },
    hasPreviousPage: () => {
      ensureObserved();
      return view().hasPreviousPage;
    },
    isFetchingNextPage: () => {
      ensureObserved();
      return view().isFetchingNextPage;
    },
    isFetchingPreviousPage: () => {
      ensureObserved();
      return view().isFetchingPreviousPage;
    },
    data: () => {
      ensureObserved();
      return view().data;
    },
    error: () => {
      ensureObserved();
      return toUndefined(view().error) as TError | undefined;
    },
    isPending: () => {
      ensureObserved();
      return view().status === 'pending';
    },
    isLoading: () => {
      ensureObserved();
      const current = view();
      return current.status === 'pending' && current.fetchStatus === 'fetching';
    },
    isFetching: () => {
      ensureObserved();
      return view().fetchStatus === 'fetching';
    },
    isSuccess: () => {
      ensureObserved();
      return view().status === 'success';
    },
    isError: () => {
      ensureObserved();
      return view().status === 'error';
    },
    isStale: () => {
      ensureObserved();
      return view().isStale;
    },
    status: () => {
      ensureObserved();
      return view().status;
    },
    fetchStatus: () => {
      ensureObserved();
      return view().fetchStatus;
    },
  });

  return query;
}
