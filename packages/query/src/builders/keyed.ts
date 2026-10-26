import { hashKey, type DefaultError, type Query, type QueryFilters } from '@tanstack/query-core';

import { makeScopeKey } from '../core/utils.js';
import { createInfiniteQuery } from '../infinite.svelte.js';
import { createQuery } from '../query.svelte.js';
import type { InfOptions, InfQuery, KeyQuery, QueryFamily, KeyedQueryConfig, PageOptions, PageQuery, QueryGroup } from '../types.js';

export function keyed<TKey, TData, TError = DefaultError, TPageParam = number>(
  config: KeyedQueryConfig<TKey, TData, TPageParam>,
): QueryFamily<TKey, TData, TError, TPageParam> {
  const { scope, queryClient } = config;
  const keyQueries = new Map<string, KeyQuery<TKey, TData, TError, TPageParam>>();
  scope.defer(() => {
    keyQueries.clear();
    queryClient.removeQueries({ queryKey: [config.name], exact: false });
  });

  const resolveInitialPageParam = (options?: InfOptions<TPageParam>): TPageParam => {
    const initialPageParam = options?.initialPageParam ?? config.initialPageParam;
    if (initialPageParam === undefined) {
      throw new Error(`[query] keyed("${config.name}").inf(): initialPageParam must be provided in config or options.`);
    }
    return initialPageParam;
  };

  const getKeyQuery = (key: TKey): KeyQuery<TKey, TData, TError, TPageParam> => {
    scope.assertOpen();

    const baseKey = makeScopeKey([config.name, key]);
    const baseHash = hashKey(baseKey);
    const cached = keyQueries.get(baseHash);
    if (cached) return cached;

    const base = createQuery<TData, TError>({
      scope,
      queryClient,
      queryKey: baseKey,
      queryFn: async ({ signal }) => {
        return await config.loader({ key, signal, type: 'static' });
      },
      options: config,
    });

    const pages = new Map<string, PageQuery<TData, TError, TPageParam>>();
    const infs = new Map<string, InfQuery<TData, TError, TPageParam>>();

    const query = Object.assign(base, {
      key,

      page(options: PageOptions<TPageParam>) {
        scope.assertOpen();

        const pageKey = makeScopeKey([config.name, key, 'page', options.page, options.pageSize ?? null]);
        const pageHash = hashKey(pageKey);

        const cachedPage = pages.get(pageHash);
        if (cachedPage) return cachedPage;

        const pageQuery = Object.assign(
          createQuery<TData, TError>({
            scope,
            queryClient,
            queryKey: pageKey,
            queryFn: async ({ signal }) => {
              return await config.loader({
                key,
                signal,
                type: 'page',
                pageParam: options.page,
                pageSize: options.pageSize,
              });
            },
            options: config,
          }),
          { page: options.page },
        ) as PageQuery<TData, TError, TPageParam>;

        pages.set(pageHash, pageQuery);
        return pageQuery;
      },

      inf(options?: InfOptions<TPageParam>) {
        scope.assertOpen();

        const initialPageParam = resolveInitialPageParam(options);
        const infKey = makeScopeKey([config.name, key, 'inf', options?.pageSize ?? null, initialPageParam]);
        const infHash = hashKey(infKey);

        const cachedInf = infs.get(infHash);
        if (cachedInf) return cachedInf;

        const infQuery = createInfiniteQuery<TData, TError, TPageParam>({
          scope,
          queryClient,
          queryKey: infKey,
          queryFn: async ({ signal, pageParam }) => {
            return await config.loader({
              key,
              signal,
              type: 'inf',
              pageParam,
              pageSize: options?.pageSize,
            });
          },
          options: config,
          initialPageParam,
          getNextPageParam: config.getNextPageParam,
          getPreviousPageParam: config.getPreviousPageParam,
        });

        infs.set(infHash, infQuery);
        return infQuery;
      },
    }) as KeyQuery<TKey, TData, TError, TPageParam>;

    keyQueries.set(baseHash, query);
    return query;
  };

  const groupOf = (match?: (key: TKey) => boolean): QueryGroup => {
    const filters: QueryFilters = {
      queryKey: [config.name],
      exact: false,
      predicate: match === undefined ? undefined : (entry: Query) => match(entry.queryKey[1] as TKey),
    };
    return {
      reset() {
        if (scope.closed) return;
        void queryClient.cancelQueries(filters).catch(() => undefined);
        queryClient.removeQueries(filters);
      },
      async cancel() {
        if (scope.closed) return;
        await queryClient.cancelQueries(filters).catch(() => undefined);
      },
      async invalidate(options) {
        if (scope.closed) return;
        await queryClient.invalidateQueries({ ...filters, refetchType: options?.refetchType }).catch(() => undefined);
      },
    };
  };

  const query: QueryFamily<TKey, TData, TError, TPageParam> = {
    name: config.name,
    key: getKeyQuery,
    all: () => groupOf(),
    where: (match) => groupOf(match),
    reset() {
      if (scope.closed) return;
      for (const query of [...keyQueries.values()]) {
        query.reset();
      }
      void queryClient.cancelQueries({ queryKey: [config.name], exact: false }).catch(() => undefined);
      queryClient.removeQueries({ queryKey: [config.name], exact: false });
    },
  };

  return query;
}
