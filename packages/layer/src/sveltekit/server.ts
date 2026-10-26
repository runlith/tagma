import type { Handle, RequestEvent } from '@sveltejs/kit';

import type { CookieDeleteOptions, CookieOptions } from '../cookies.js';
import type { Provided } from '../key.js';
import { Layer, type LayerLike } from '../Layer.js';
import { Platform, serverPlatform, type PlatformCookies } from '../Platform.js';
import { currentRequestApp, withRequestApp } from '../request/node.js';
import { emptyRouteData, Router, type RouteId } from '../Router.js';
import { MountedApp, App as Core, type ClosedBy, type Definition } from '../App.js';
import type { AnyRung } from '../Rung.js';
import { worldHooks } from '../svelte/App.svelte.js';

const FORWARDED_PROTOCOLS = new Set(['http', 'https']);

function first(value: string | null): string | undefined {
  const head = value?.split(',')[0]?.trim();
  return head ? head : undefined;
}

function protocolOf(value: string | undefined): string | undefined {
  const normalized = value?.toLowerCase();
  return normalized && FORWARDED_PROTOCOLS.has(normalized) ? normalized : undefined;
}

function cloudflareProtocol(headers: Headers): string | undefined {
  const visitor = headers.get('cf-visitor');
  if (!visitor) return undefined;
  try {
    const parsed = JSON.parse(visitor) as { scheme?: unknown };
    return protocolOf(typeof parsed.scheme === 'string' ? parsed.scheme : undefined);
  } catch {
    return undefined;
  }
}

function hostOf(value: string | undefined): string | undefined {
  const host = value?.trim().toLowerCase();
  if (!host || host.includes('/') || host.includes(' ')) return undefined;
  try {
    return new URL(`http://${host}`).host;
  } catch {
    return undefined;
  }
}

export function requestUrl(url: URL, headers: Headers): URL {
  const protocol = cloudflareProtocol(headers) ?? protocolOf(first(headers.get('x-forwarded-proto'))) ?? url.protocol.slice(0, -1);
  const host = hostOf(first(headers.get('x-forwarded-host'))) ?? hostOf(first(headers.get('host'))) ?? url.host;
  return new URL(`${protocol}://${host}${url.pathname}${url.search}`);
}

function acceptedLanguages(header: string | null): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const quality = params.map((param) => param.trim()).find((param) => param.startsWith('q='));
      const q = quality ? Number(quality.slice(2)) : 1;
      return { tag: tag.trim(), q: Number.isFinite(q) ? q : 1 };
    })
    .filter(({ tag }) => tag && tag !== '*')
    .sort((a, b) => b.q - a.q)
    .map(({ tag }) => tag);
}

function requestCookies(event: RequestEvent, url: URL): PlatformCookies {
  const secure = url.protocol === 'https:';
  const attributes = (options: CookieDeleteOptions) => ({
    path: options.path ?? '/',
    sameSite: options.sameSite ?? 'lax',
    secure: options.secure ?? secure,
    httpOnly: false,
    domain: options.domain,
    partitioned: options.partitioned,
    priority: options.priority,
  });

  return {
    get: (name) => event.cookies.get(name),
    all: () => Object.fromEntries(event.cookies.getAll().map(({ name, value }) => [name, value])),
    set: (name, value, options: CookieOptions = {}) =>
      event.cookies.set(name, value, {
        ...attributes(options),
        maxAge: options.maxAgeSeconds,
        expires: options.expires,
      }),
    delete: (name, options = {}) => event.cookies.delete(name, attributes(options)),
  };
}

function requestRouter(event: RequestEvent, url: URL): Router {
  return new Router({
    url: () => url,
    routeId: () => (event.route.id ?? undefined) as RouteId | undefined,
    params: () => event.params as Record<string, string>,
    status: () => 200,
    data: () => currentRequestApp()?.address.data ?? emptyRouteData(),
    goto: () => Promise.reject(new Error('Router.goto on the server: a load answers with redirect() instead')),
    invalidate: () => Promise.resolve(),
    historyIndex: () => undefined,
    traverse: () => {
      throw new Error('Router.traverse on the server: a request has no history to step through');
    },
    reload: () => {
      throw new Error('Router.reload on the server: a request has no document to reload');
    },
    load: () => {
      throw new Error('Router.load on the server: a load answers with redirect() instead');
    },
  });
}

export type ServerWorld = Layer<Provided<typeof Platform> | Provided<typeof Router>, never>;

export function ServerLive(event: RequestEvent): ServerWorld {
  const headers = event.request.headers;
  const url = requestUrl(event.url, headers);
  const platform = serverPlatform({
    cookies: requestCookies(event, url),
    fetch: event.fetch,
    languages: acceptedLanguages(headers.get('accept-language')),
    userAgent: headers.get('user-agent') ?? undefined,
  });
  return Layer.mergeAll(Layer.of(Platform, platform), Layer.of(Router, requestRouter(event, url))) as ServerWorld;
}

export interface AppHandleInput {
  readonly event: RequestEvent;
  readonly resolve: Parameters<Handle>[0]['resolve'];
  readonly app: MountedApp;
}

export type AppHandle = (input: AppHandleInput) => Promise<Response> | Response;

export const App = {
  ...Core,

  handle<M extends LayerLike, L extends readonly AnyRung[]>(
    definition: Definition<M, L> & ClosedBy<M, ServerWorld, L>,
    run: AppHandle,
  ): Handle {
    return ({ event, resolve }) => {
      const app = new MountedApp(definition, ServerLive(event), worldHooks);
      return withRequestApp(crypto.randomUUID(), app, () => Promise.resolve(run({ event, resolve, app })));
    };
  },
} as const;
