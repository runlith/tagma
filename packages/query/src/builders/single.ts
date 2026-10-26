import { hashKey, type DefaultError } from '@tanstack/query-core';

import { makeScopeKey } from '../core/utils.js';
import { createInfiniteQuery } from '../infinite.svelte.js';
import { createQuery } from '../query.svelte.js';
import type { QueryGroup, InfOptions, InfQuery, PageOptions, PageQuery, SingleQuery, SingleQueryConfig } from '../types.js';

export function single<TData, TError = DefaultError, TPageParam = number>(
  config: SingleQueryConfig<TData, TPageParam>,
): SingleQuery<TData, TError, TPageParam> {
  const { scope, queryClient } = config;

  const pages = new Map<string, PageQuery<TData, TError, TPageParam>>();
  const infs = new Map<string, InfQuery<TData, TError, TPageParam>>();
  scope.defer(() => {
    pages.clear();
    infs.clear();
    queryClient.removeQueries({ queryKey: [config.name], exact: false });
  });

  const base = createQuery<TData, TError>({
    scope,
    queryClient,
    queryKey: makeScopeKey([config.name]),
    queryFn: async ({ signal }) => {
      return await config.loader({ signal, type: 'static' });
    },
    options: config,
  });

  const resolveInitialPageParam = (options?: InfOptions<TPageParam>): TPageParam => {
    const initialPageParam = options?.initialPageParam ?? config.initialPageParam;
    if (initialPageParam === undefined) {
      throw new Error(`[query] single("${config.name}").inf(): initialPageParam must be provided in config or options.`);
    }
    return initialPageParam;
  };

  const query = Object.assign(base, {
    name: config.name,

    page(options: PageOptions<TPageParam>) {
      scope.assertOpen();

      const pageKey = makeScopeKey([config.name, 'page', options.page, options.pageSize ?? null]);
      const queryHash = hashKey(pageKey);
      const cached = pages.get(queryHash);
      if (cached) return cached;

      const pageQuery = Object.assign(
        createQuery<TData, TError>({
          scope,
          queryClient,
          queryKey: pageKey,
          queryFn: async ({ signal }) => {
            return await config.loader({
              signal,
              type: 'page',
              pageParam: options.page,
              pageSize: options.pageSize,
            });
          },
          options: config,
        }),
        {
          page: options.page,
        },
      ) as PageQuery<TData, TError, TPageParam>;

      pages.set(queryHash, pageQuery);
      return pageQuery;
    },

    inf(options?: InfOptions<TPageParam>) {
      scope.assertOpen();

      const initialPageParam = resolveInitialPageParam(options);
      const infKey = makeScopeKey([config.name, 'inf', options?.pageSize ?? null, initialPageParam]);
      const queryHash = hashKey(infKey);
      const cached = infs.get(queryHash);
      if (cached) return cached;

      const infQuery = createInfiniteQuery<TData, TError, TPageParam>({
        scope,
        queryClient,
        queryKey: infKey,
        queryFn: async ({ signal, pageParam }) => {
          return await config.loader({
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

      infs.set(queryHash, infQuery);
      return infQuery;
    },

    all(): QueryGroup {
      return {
        reset() {
          if (scope.closed) return;
          void queryClient.cancelQueries({ queryKey: [config.name], exact: false }).catch(() => undefined);
          queryClient.removeQueries({ queryKey: [config.name], exact: false });
        },
        async cancel() {
          if (scope.closed) return;
          await queryClient.cancelQueries({ queryKey: [config.name], exact: false }).catch(() => undefined);
        },
        async invalidate(options) {
          if (scope.closed) return;
          await queryClient
            .invalidateQueries({ queryKey: [config.name], exact: false, refetchType: options?.refetchType })
            .catch(() => undefined);
        },
      };
    },
  }) as SingleQuery<TData, TError, TPageParam>;

  return query;
}
