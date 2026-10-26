import { MutationObserver, type DefaultError, type QueryClient } from '@tanstack/query-core';
import type { Scope } from '@runlith/layer/Scope';

import { toUndefined } from './core/utils.js';

const MUTATION_OWNER_META_KEY = '@runlith/query:mutation-owner';

export type MutationStatus = 'idle' | 'pending' | 'success' | 'error';

export type MutationRunOptions = {
  throwOnError?: boolean;
};

export type Mutation<TData, TVariables, TError> = {
  readonly data: TData | undefined;
  readonly error: TError | undefined;
  readonly pending: boolean;
  readonly status: MutationStatus;

  run(variables: TVariables, options?: MutationRunOptions): Promise<TData | undefined>;
  reset(): void;
  in(scope: Scope): Mutation<TData, TVariables, TError>;
};

export type MutationConfig<TData, TVariables> = {
  name: string;
  scope: Scope;
  concurrency?: 'latest' | 'parallel';
  mutator: (variables: TVariables, context: { signal: AbortSignal }) => Promise<TData>;
  queryClient: QueryClient;
};

export function mutation<TData, TVariables = void, TError = DefaultError>(
  config: MutationConfig<TData, TVariables>,
): Mutation<TData, TVariables, TError> {
  const { scope, queryClient } = config;

  let data = $state.raw<TData | undefined>(undefined);
  let error = $state.raw<TError | undefined>(undefined);
  let activeRunCount = $state(0);
  let status = $state<MutationStatus>('idle');

  const activeAbortControllers = new Set<AbortController>();
  const mutationOwner = {};
  let currentObserver: MutationObserver<TData, TError, TVariables> | undefined;

  const abortActiveRuns = () => {
    for (const controller of activeAbortControllers) controller.abort();
    activeAbortControllers.clear();
    activeRunCount = 0;
  };

  const sync = (observer: MutationObserver<TData, TError, TVariables>) => {
    const result = observer.getCurrentResult();
    data = result.data;
    error = toUndefined(result.error) as TError | undefined;
    status = result.status;
  };

  const resetState = () => {
    data = undefined;
    error = undefined;
    activeRunCount = 0;
    status = 'idle';
  };

  const removeSettledOwnedMutations = () => {
    const mutationCache = queryClient.getMutationCache();
    for (const mutation of mutationCache.getAll()) {
      if (mutation.meta?.[MUTATION_OWNER_META_KEY] !== mutationOwner) continue;
      if (mutation.state.status === 'pending') continue;
      mutationCache.remove(mutation);
    }
  };

  scope.defer(() => {
    currentObserver = undefined;
    abortActiveRuns();
    removeSettledOwnedMutations();
    resetState();
  });

  const query: Mutation<TData, TVariables, TError> = {
    get data() {
      return data;
    },
    get error() {
      return error;
    },
    get pending() {
      return activeRunCount > 0;
    },
    get status() {
      return activeRunCount > 0 ? 'pending' : status;
    },

    async run(variables, options) {
      if (scope.closed) return undefined;

      if (config.concurrency === 'latest') abortActiveRuns();
      const nextAbortController = new AbortController();
      activeAbortControllers.add(nextAbortController);
      activeRunCount = activeAbortControllers.size;

      const observer = new MutationObserver<TData, TError, TVariables>(queryClient, {
        mutationKey: [config.name],
        meta: { [MUTATION_OWNER_META_KEY]: mutationOwner },
        mutationFn: async (nextVariables) => {
          nextAbortController.signal.throwIfAborted();
          return await config.mutator(nextVariables, { signal: nextAbortController.signal });
        },
      });
      currentObserver = observer;
      const unsubscribe = observer.subscribe(() => {
        if (currentObserver === observer && !scope.closed) sync(observer);
      });
      sync(observer);

      const throwOnError = options?.throwOnError ?? false;
      queryClient.mount();

      try {
        const value = await observer.mutate(variables);
        return scope.closed || nextAbortController.signal.aborted ? undefined : value;
      } catch (error) {
        if (nextAbortController.signal.aborted) return undefined;
        if (throwOnError) throw error;
        return undefined;
      } finally {
        unsubscribe();
        activeAbortControllers.delete(nextAbortController);
        activeRunCount = activeAbortControllers.size;
        queryClient.unmount();
        if (scope.closed) removeSettledOwnedMutations();
      }
    },

    reset() {
      currentObserver = undefined;
      abortActiveRuns();
      resetState();
    },

    in(owner) {
      return mutation<TData, TVariables, TError>({ ...config, scope: owner, concurrency: 'latest' });
    },
  };

  return query;
}
