import { type Context, Effect } from 'effect';
import type { HttpServerRequest, HttpServerResponse } from 'effect/http';

export type RouteHandler = (request: HttpServerRequest.HttpServerRequest) => Effect.Effect<HttpServerResponse.HttpServerResponse>;

export type Route<R = any> = {
  readonly path: `/${string}`;
  readonly preAdmitted: boolean;
  readonly handler: (door: Context.Context<R>) => Effect.Effect<RouteHandler>;
};

export type DoorPath = { readonly path: string; readonly prefix: boolean };

export const route = <R>(declared: {
  readonly path: `/${string}`;
  readonly preAdmitted?: true;
  readonly handler: (door: Context.Context<R>) => RouteHandler | Promise<RouteHandler>;
}): Route<R> => ({
  path: declared.path,
  preAdmitted: declared.preAdmitted === true,
  handler: (door) => Effect.promise(async () => declared.handler(door)),
});

export const routedPath = (url: string): string | null => {
  const cut = url.search(/[?#]/u);
  let decoded: string;
  try {
    decoded = decodeURIComponent(cut === -1 ? url : url.slice(0, cut));
  } catch {
    return null;
  }
  const collapsed = decoded.toLowerCase().replace(/\/+/gu, '/');
  return collapsed.length > 1 ? collapsed.replace(/\/$/u, '') : collapsed;
};

export const overlaps = (path: string, served: DoorPath): boolean => {
  const own = routedPath(served.path);
  if (own === null) return false;
  return path === own || (served.prefix && path.startsWith(own === '/' ? own : `${own}/`));
};
