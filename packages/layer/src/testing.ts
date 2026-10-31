import { Host, type HostInput } from './Host.js';
import type { Deferred } from './key.js';
import { Point } from './Point.js';
import { Platform, type PlatformCookies, type PlatformFetch, type PlatformSocket, type PlatformStorage } from './Platform.js';
import { emptyRouteData, Router, type RouteData, type RouteId, type RouterSource } from './Router.js';
import { Rung } from './Rung.js';

export type VisitorInput = { readonly kind: 'user' | 'guest'; readonly id: string };

export const Visitor = {
  ...Rung.define<VisitorInput, 'user' | 'guest'>()('visitor', {
    keyOf: (input) => (input.kind === 'user' ? `user:${input.id}` : 'guest'),
    kindOf: (input) => input.kind,
    kinds: ['user', 'guest'],
  }),
  user(id: string): VisitorInput {
    return { kind: 'user', id };
  },
  guest(): VisitorInput {
    return { kind: 'guest', id: 'guest' };
  },
} as const;

export function makeHost(at: Partial<HostInput> = {}): Host {
  return new Host(at.kind ?? 'tab', at.os ?? 'unknown', { touch: at.touch, installed: at.installed });
}

type PointKey<Item> = { readonly id: string; readonly definition: Parameters<typeof Point.over<Item>>[1] };

export function makePoint<Item>(key: PointKey<Item>, ...items: readonly NoInfer<Item>[]): Point<Item> {
  const point = Point.over<Item>(key.id, key.definition, { current: undefined });
  if (items.length > 0) point.register('test', ...items);
  return point;
}

export function makeDeferred<T>(value: T): Deferred<T> {
  const ready = Promise.resolve(value);
  return { current: value, ready, then: (onFulfilled, onRejected) => ready.then(onFulfilled, onRejected) };
}

export function makeStorage(entries: Record<string, string> = {}): PlatformStorage {
  const values = new Map(Object.entries(entries));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
    keys: (prefix) => [...values.keys()].filter((key) => key.startsWith(prefix)),
    watch: () => () => undefined,
  };
}

export function makeSharedStorage(entries: Record<string, string> = {}): () => PlatformStorage {
  const values = new Map(Object.entries(entries));
  const watching = new Set<{ readonly from: PlatformStorage; readonly key: string; readonly listener: (value: string | null) => void }>();
  const told = (from: PlatformStorage, key: string, value: string | null): void => {
    for (const one of [...watching]) if (one.from !== from && one.key === key) one.listener(value);
  };
  return () => {
    const storage: PlatformStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
        told(storage, key, value);
      },
      removeItem: (key) => {
        values.delete(key);
        told(storage, key, null);
      },
      keys: (prefix) => [...values.keys()].filter((key) => key.startsWith(prefix)),
      watch: (key, listener) => {
        const one = { from: storage, key, listener };
        watching.add(one);
        return () => void watching.delete(one);
      },
    };
    return storage;
  };
}

export function makeRefusingStorage(): PlatformStorage {
  return { getItem: () => null, setItem: () => undefined, removeItem: () => undefined, keys: () => [], watch: () => () => undefined };
}

export function makeCookies(entries: Record<string, string> = {}): PlatformCookies {
  const values = new Map(Object.entries(entries));
  return {
    all: () => Object.fromEntries(values),
    get: (name) => values.get(name),
    set: (name, value) => void values.set(name, value),
    delete: (name) => void values.delete(name),
  };
}

export function makePlatform(
  at: {
    local?: PlatformStorage;
    session?: PlatformStorage;
    cookies?: PlatformCookies;
    fetch?: PlatformFetch;
    socket?: PlatformSocket;
    databases?: IDBFactory;
    locks?: LockManager | null;
    languages?: readonly string[];
  } = {},
): Platform {
  return new Platform({ local: at.local ?? makeStorage(), session: at.session ?? at.local ?? makeStorage() }, at.cookies ?? makeCookies(), {
    kind: 'browser',
    fetch: at.fetch,
    socket: at.socket,
    databases: at.databases,
    locks: at.locks,
    languages: at.languages,
  });
}

export interface RouterAt {
  url?: URL | (() => URL);
  routeId?: RouteId | undefined;
  params?: Record<string, string>;
  status?: number;
  data?: RouteData;
  goto?: RouterSource['goto'];
  invalidate?: RouterSource['invalidate'];
  historyIndex?: RouterSource['historyIndex'];
  traverse?: RouterSource['traverse'];
  reload?: RouterSource['reload'];
  load?: RouterSource['load'];
}

export function makeRouter(at: RouterAt = {}): Router {
  const url = at.url ?? new URL('http://localhost/');
  const source: RouterSource = {
    url: () => (typeof url === 'function' ? url() : url),
    routeId: () => at.routeId,
    params: () => at.params ?? {},
    status: () => at.status ?? 200,
    data: () => at.data ?? emptyRouteData(),
    goto: at.goto ?? (async () => undefined),
    invalidate: at.invalidate ?? (async () => undefined),
    historyIndex: at.historyIndex ?? (() => undefined),
    traverse: at.traverse ?? (() => undefined),
    reload: at.reload ?? (() => undefined),
    load: at.load ?? (() => undefined),
  };

  return new Router(source);
}

export function makeRouterWithLog(at: RouterAt = {}): {
  router: Router;
  visited: { href: string; replaced: boolean }[];
  invalidated: string[];
} {
  const visited: { href: string; replaced: boolean }[] = [];
  const invalidated: string[] = [];

  const router = makeRouter({
    ...at,
    goto: async (href, options) => {
      visited.push({ href, replaced: options?.replaceState === true });
    },
    invalidate: async (dependency) => {
      invalidated.push(dependency);
    },
  });

  return { router, visited, invalidated };
}
