import type { DefaultError, DehydratedState, QueryClient } from '@tanstack/query-core';
import { Handoff } from '@runlith/layer/Handoff';
import { Layer } from '@runlith/layer/Layer';
import { Platform } from '@runlith/layer/Platform';
import { Scope, type ScopeKey } from '@runlith/layer/Scope';
import { Service, type AnyKeyClass, type InstanceOf, type Provided, type ReachableFrom, type Tier } from '@runlith/layer/key';
import { Snapshot, type SnapshotPart } from '@runlith/layer/Snapshot';

import { keyed } from './builders/keyed.js';
import { single } from './builders/single.js';
import { createQueryClient, dehydrateQueryClient, hydrateQueryClient, type CreateQueryClientOptions } from './hydration.js';
import { mutation, type Mutation } from './mutation.svelte.js';
import type {
  BaseQueryOptions,
  KeyedLoaderContext,
  KeyedQueryConfig,
  QueryFamily,
  SingleLoaderContext,
  SingleQuery,
  SingleQueryConfig,
} from './types.js';

export class CacheSnapshot extends Service<SnapshotPart>()('Cache.snapshot', { tier: 'app', eager: true }) {}

export class Cache extends Service<QueryClient>()('Cache', { tier: 'app' }) {
  static invalidate(client: QueryClient, scope: Scope, repos?: readonly AnyKeyClass[]): Promise<void> {
    return client.invalidateQueries({ predicate: (query) => Cache.owns(scope, query.queryKey, repos) });
  }

  static remove(client: QueryClient, scope: Scope, repos?: readonly AnyKeyClass[]): void {
    client.removeQueries({ predicate: (query) => Cache.owns(scope, query.queryKey, repos) });
  }

  static owns(scope: Scope, queryKey: readonly unknown[], repos?: readonly AnyKeyClass[]): boolean {
    const name = queryKey[0];
    if (typeof name !== 'string') return false;
    const prefix = namePrefix(scope);
    if (!name.startsWith(prefix)) return false;
    const rest = name.slice(prefix.length);
    if (repos === undefined) return true;
    return repos.some((key) => {
      const spec = specs.get(key);
      if (!spec) throw new Error(`Cache.owns expects Repo.define keys, got "${key.id}"`);
      return rest.startsWith(`${spec.id}.`);
    });
  }

  static of(options?: CreateQueryClientOptions) {
    return Layer.mergeAll(
      Layer.provide(Cache, function* () {
        const scope = yield* Scope;
        const platform = yield* Platform;
        const handoff = yield* Handoff;
        const client = createQueryClient({ isBrowser: platform.isBrowser, ...options });
        client.mount();
        void client.resumePausedMutations();
        scope.defer(
          handoff.onClosed((closed) => {
            if (closed.tier !== 'app') void Cache.remove(client, closed);
          }),
        );
        scope.defer(() => {
          client.unmount();
          client.clear();
        });
        return client;
      }),
      Snapshot.part(
        Layer.provide(CacheSnapshot, function* () {
          const client = yield* Cache;
          return {
            take: () => dehydrateQueryClient(client),
            apply: (state) => hydrateQueryClient(client, state as DehydratedState),
          };
        }),
      ),
    );
  }
}

type Call<Door, TPayload, TData> = (door: Door, payload: TPayload) => Promise<TData>;

type Deps<Door> = { scope: Scope; door: Door; queryClient: QueryClient };

export type Tuning = Pick<BaseQueryOptions, 'staleTime' | 'gcTime' | 'refetchInterval' | 'live'>;

type Descriptor<TQuery, Door = unknown> = {
  build(name: string, deps: Deps<Door>, tuning?: Tuning): TQuery;
};

type PageFields<TData, TPageParam> = {
  getNextPageParam?: (lastPage: TData, allPages: TData[], lastPageParam: TPageParam) => TPageParam | undefined;
  getPreviousPageParam?: (firstPage: TData, allPages: TData[], firstPageParam: TPageParam) => TPageParam | undefined;
  initialPageParam?: TPageParam;
};

type SingleOptions<TPayload, TData, TPageParam> = BaseQueryOptions &
  PageFields<TData, TPageParam> & {
    payload?: (context: SingleLoaderContext<TPageParam>) => Omit<TPayload, 'signal'>;
  };

type KeyedOptions<TKey, TPayload, TData, TPageParam> = BaseQueryOptions &
  PageFields<TData, TPageParam> & {
    payload?: (key: TKey, context: KeyedLoaderContext<TKey, TPageParam>) => Omit<TPayload, 'signal'>;
  };

function payloadOf<TPayload>(extra: object | undefined, signal: AbortSignal | undefined): TPayload {
  return { ...(extra ?? {}), signal } as TPayload;
}

type Reach<Door, TPayload, TData> = () => Promise<Call<Door, TPayload, TData>>;

type SingleFull<Door, TData, TPageParam> = Omit<SingleQueryConfig<TData, TPageParam>, 'name' | 'scope' | 'queryClient' | 'loader'> & {
  loader: (context: SingleLoaderContext<TPageParam>, door: Door) => Promise<TData>;
};

type KeyedFull<Door, TKey, TData, TPageParam> = Omit<
  KeyedQueryConfig<TKey, TData, TPageParam>,
  'name' | 'scope' | 'queryClient' | 'loader'
> & {
  loader: (context: KeyedLoaderContext<TKey, TPageParam>, door: Door) => Promise<TData>;
};

type MutationFull<Door, TData, TVariables> = {
  concurrency?: 'latest' | 'parallel';
  mutator: (variables: TVariables, context: { signal: AbortSignal }, door: Door) => Promise<TData>;
};

export type RepoContext<Door> = {
  single<TPayload, TData, TPageParam = number>(
    reach: Reach<Door, TPayload, TData>,
    options?: SingleOptions<TPayload, TData, TPageParam>,
  ): Descriptor<SingleQuery<TData, DefaultError, TPageParam>, Door>;
  single<TData, TPageParam = number>(
    config: SingleFull<Door, TData, TPageParam>,
  ): Descriptor<SingleQuery<TData, DefaultError, TPageParam>, Door>;

  keyed<TKey, TPayload, TData, TPageParam = number>(
    reach: Reach<Door, TPayload, TData>,
    options?: KeyedOptions<TKey, TPayload, TData, TPageParam>,
  ): Descriptor<QueryFamily<TKey, TData, DefaultError, TPageParam>, Door>;
  keyed<TKey, TData, TPageParam = number>(
    config: KeyedFull<Door, TKey, TData, TPageParam>,
  ): Descriptor<QueryFamily<TKey, TData, DefaultError, TPageParam>, Door>;

  mutation<TPayload, TData, TVariables = void>(
    reach: Reach<Door, TPayload, TData>,
    options?: { payload?: (variables: TVariables) => Omit<TPayload, 'signal'> },
  ): Descriptor<Mutation<TData, TVariables, DefaultError>, Door>;
  mutation<TData, TVariables = void>(
    config: MutationFull<Door, TData, TVariables>,
  ): Descriptor<Mutation<TData, TVariables, DefaultError>, Door>;
};

type AnyCall = (door: unknown, payload: unknown) => Promise<unknown>;
type AnyReach = () => Promise<AnyCall>;
type AnyLoader = (context: never, door: unknown) => Promise<unknown>;
type AnyDeps = Deps<unknown>;

const context = {
  single(first: AnyReach | { loader: unknown }, options?: Record<string, unknown>) {
    return {
      build(name: string, deps: AnyDeps, tuning?: Tuning) {
        const base = { name, scope: deps.scope, queryClient: deps.queryClient };
        if (typeof first !== 'function') {
          const { loader, ...rest } = first as { loader: AnyLoader };
          return single({ ...rest, ...tuning, ...base, loader: (c) => loader(c as never, deps.door) });
        }

        return single({
          ...options,
          ...tuning,
          ...base,
          loader: async (loaderContext) => {
            const call = await first();
            const payload = (options?.['payload'] as ((c: unknown) => object) | undefined)?.(loaderContext);
            return await call(deps.door, payloadOf(payload, loaderContext.signal));
          },
        });
      },
    };
  },

  keyed(first: AnyReach | { loader: unknown }, options?: Record<string, unknown>) {
    return {
      build(name: string, deps: AnyDeps, tuning?: Tuning) {
        const base = { name, scope: deps.scope, queryClient: deps.queryClient };
        if (typeof first !== 'function') {
          const { loader, ...rest } = first as { loader: AnyLoader };
          return keyed({ ...rest, ...tuning, ...base, loader: (c) => loader(c as never, deps.door) });
        }

        return keyed({
          ...options,
          ...tuning,
          ...base,
          loader: async (loaderContext) => {
            const call = await first();
            const payload = (options?.['payload'] as ((k: unknown, c: unknown) => object) | undefined)?.(loaderContext.key, loaderContext);
            return await call(deps.door, payloadOf(payload, loaderContext.signal));
          },
        });
      },
    };
  },

  mutation(first: AnyReach | { mutator: unknown }, options?: Record<string, unknown>) {
    return {
      build(name: string, deps: AnyDeps) {
        const base = { name, scope: deps.scope, queryClient: deps.queryClient };
        if (typeof first !== 'function') {
          const { mutator, concurrency } = first as {
            concurrency?: 'latest' | 'parallel';
            mutator: (variables: unknown, runContext: { signal: AbortSignal }, door: unknown) => Promise<unknown>;
          };
          return mutation({
            ...base,
            concurrency,
            mutator: (variables, runContext) => mutator(variables, runContext, deps.door),
          });
        }

        return mutation({
          ...base,
          mutator: async (variables, runContext) => {
            const call = await first();
            const payload = (options?.['payload'] as ((v: unknown) => object) | undefined)?.(variables);
            return await call(deps.door, payloadOf(payload, runContext.signal));
          },
        });
      },
    };
  },
} as unknown as RepoContext<unknown>;

type Built<TDescriptors> = {
  [Field in keyof TDescriptors]: TDescriptors[Field] extends Descriptor<infer TQuery, unknown> ? TQuery : never;
};

type Spec = {
  id: string;
  door: AnyKeyClass;
  build: (context: RepoContext<unknown>) => Record<string, Descriptor<unknown>>;
};

const specs = new WeakMap<object, Spec>();

type RepoNeeds<Door extends AnyKeyClass> = Provided<Door> | Provided<typeof Cache> | ScopeKey;

function namePrefix(scope: Scope): string {
  const home = scope.home;
  return home.tier === 'app' ? '' : `${home.name}/`;
}

function nameOf<K extends AnyKeyClass>(key: K, field: string, scope: Scope): string {
  const spec = specs.get(key);
  if (!spec) throw new Error(`Repo.nameOf expects a Repo.define key, got "${key.id}"`);
  const owner = scope.owner(key.tier);
  if (!owner) throw new Error(`Repo.nameOf: no scope of "${scope.name}" hosts the ${key.tier}-tier repo "${key.id}"`);
  return `${namePrefix(owner)}${spec.id}.${field}`;
}

function* assemble<Door extends AnyKeyClass>(
  spec: Spec,
  tuning: Record<string, Tuning>,
): Generator<RepoNeeds<Door>, Record<string, unknown>, unknown> {
  const scope = yield* Scope;
  const door = yield spec.door.key as Provided<Door>;
  const queryClient = yield* Cache;
  const deps: AnyDeps = { scope, door, queryClient };

  const descriptors = spec.build(context);
  const queries: Record<string, unknown> = {};
  const prefix = namePrefix(scope);
  for (const [field, descriptor] of Object.entries(descriptors)) {
    queries[field] = descriptor.build(`${prefix}${spec.id}.${field}`, deps, tuning[field]);
  }

  return queries;
}

export interface RepoOptions<Door extends AnyKeyClass, Tr extends Tier = Tier> {
  readonly tier: Tr;
  readonly door: Door;
}

type RepoKeyClass<Door extends AnyKeyClass> = AnyKeyClass & { readonly door: Door };

function define<
  Door extends AnyKeyClass,
  TDescriptors extends Record<string, Descriptor<unknown, InstanceOf<Door>>>,
  const Id extends string,
  const Tr extends Tier,
>(id: Id, build: (context: RepoContext<InstanceOf<Door>>) => TDescriptors, options: RepoOptions<Door, Tr>) {
  const spec: Spec = { id, door: options.door, build: build as unknown as Spec['build'] };

  class Repository extends Service<Built<TDescriptors>>()(id, { tier: options.tier }) {
    static readonly door: Door = options.door;

    static *make() {
      return (yield* assemble<Door>(spec, {})) as Built<TDescriptors>;
    }
  }

  specs.set(Repository, spec);

  return Repository;
}

function tune<K extends RepoKeyClass<AnyKeyClass>>(
  key: K,
  tuning: Partial<Record<string, Tuning>>,
): Layer<Provided<K>, ReachableFrom<K, RepoNeeds<K['door']>>> {
  const spec = specs.get(key);
  if (!spec) throw new Error(`Repo.tune expects a Repo.define key, got "${key.id}"`);

  return Layer.provide(key, function* () {
    return (yield* assemble<K['door']>(spec, tuning as Record<string, Tuning>)) as never;
  }) as Layer<Provided<K>, ReachableFrom<K, RepoNeeds<K['door']>>>;
}

function prefixOf(scope: Scope): string {
  return namePrefix(scope);
}

export const Repo = { define, tune, nameOf, prefixOf };
