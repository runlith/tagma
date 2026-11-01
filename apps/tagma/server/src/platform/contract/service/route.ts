import { type Context, Effect, type Scope } from 'effect';
import type { HttpServerRequest, HttpServerResponse } from 'effect/http';
import type { RightKey } from '../wire/right.js';

type RouteAsked = {
  readonly request: HttpServerRequest.HttpServerRequest;
  readonly params: Readonly<Record<string, string | undefined>>;
  readonly project: number | null;
};

export type RouteHandler = (asked: RouteAsked) => Effect.Effect<HttpServerResponse.HttpServerResponse, never, Scope.Scope>;

export type Route<R = any> = {
  readonly path: `/${string}`;
  readonly preAdmitted: boolean;
  readonly right: RightKey | undefined;
  readonly handler: (door: Context.Context<R>) => Effect.Effect<RouteHandler>;
};

export type DoorPath = { readonly path: string; readonly prefix: boolean; readonly modules?: true };

type Admitted = { readonly preAdmitted: true; readonly right?: never } | { readonly preAdmitted?: never; readonly right?: RightKey };

export const route = <R>(
  declared: {
    readonly path: `/${string}`;
    readonly handler: (door: Context.Context<R>) => RouteHandler | Promise<RouteHandler>;
  } & Admitted,
): Route<R> => ({
  path: declared.path,
  preAdmitted: declared.preAdmitted === true,
  right: declared.right,
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

const segmentsMeet = (one: string, other: string): boolean => {
  const left = one.split('/');
  const right = other.split('/');
  return left.length === right.length && left.every((part, at) => part === right[at] || part.startsWith(':') || right[at]!.startsWith(':'));
};

export const overlaps = (path: string, served: DoorPath): boolean => {
  const own = routedPath(served.path);
  if (own === null) return false;
  return served.prefix ? path === own || path.startsWith(own === '/' ? own : `${own}/`) : segmentsMeet(path, own);
};

const RANGE = /^bytes=(\d*)-(\d*)$/u;

type Span = { readonly start: number; readonly end: number };

export const spanOf = (range: string | undefined, size: number): Span | 'unsatisfiable' | null => {
  const asked = range === undefined ? null : RANGE.exec(range.trim());
  const from = asked?.[1] ?? '';
  const to = asked?.[2] ?? '';
  if (asked === null || (from === '' && to === '')) return null;
  const start = from === '' ? Math.max(0, size - Number(to)) : Number(from);
  const end = from === '' || to === '' ? size - 1 : Math.min(Number(to), size - 1);
  return start > end || start >= size ? 'unsatisfiable' : { start, end };
};
