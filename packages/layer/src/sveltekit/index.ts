import { afterNavigate, beforeNavigate, goto, invalidate } from '$app/navigation';
import { navigating, page } from '$app/state';
import type { LoadEvent, NavigationTarget } from '@sveltejs/kit';
import { BROWSER } from 'esm-env';
import { untrack } from 'svelte';

import type { Ask } from '../key.js';
import { Entry, Layer, type LayerLike } from '../Layer.js';
import { BrowserLive as PlatformLive } from '../Platform/browser.js';
import { currentApp, holdApp, landApp } from '../request/holder.js';
import { MountedApp, type ClosedBy, type Definition } from '../App.js';
import {
  Router,
  type Navigation,
  type NavigationListener,
  type NavigationPlace,
  type NavigationType,
  type RouteData,
  type RouteId,
} from '../Router.js';
import type { AnyRung } from '../Rung.js';
import { Snapshot } from '../Snapshot.js';
import { App as SvelteApp, worldHooks } from '../svelte/App.svelte.js';

let loading: { readonly url: URL; readonly routeId: RouteId | undefined } | undefined;

const landed = (): boolean => page.url.protocol !== 'a:';

const gotos = new Set<Promise<void>>();

const HISTORY_INDEX = 'sveltekit:history';

function historyIndex(): number | undefined {
  const index: unknown = history.state?.[HISTORY_INDEX];
  return typeof index === 'number' ? index : undefined;
}

async function afterNavigations(dependency: string): Promise<void> {
  let waited: Promise<void> | null = null;
  for (;;) {
    const performing = untrack(() => navigating.complete);
    const pending = performing === null || performing === waited ? [...gotos] : [...gotos, performing];
    if (pending.length === 0) return invalidate(dependency);
    waited = performing;
    await Promise.allSettled(pending);
  }
}

function placeOf(target: NavigationTarget | null): NavigationPlace | null {
  if (target === null) return null;
  return { url: target.url, routeId: (target.route.id ?? undefined) as RouteId | undefined, params: target.params ?? {} };
}

function navigationOf(navigation: {
  readonly type: NavigationType;
  readonly from: NavigationTarget | null;
  readonly to: NavigationTarget | null;
}): Navigation {
  return { type: navigation.type, from: placeOf(navigation.from), to: placeOf(navigation.to) };
}

let toldBefore: object | null = null;
let toldAfter: object | null = null;

function follow(listener: Required<NavigationListener>): void {
  beforeNavigate((navigation) => {
    if (navigation === toldBefore) return;
    toldBefore = navigation;
    listener.before(navigationOf(navigation));
  });
  afterNavigate((navigation) => {
    if (navigation === toldAfter) return;
    toldAfter = navigation;
    listener.after(navigationOf(navigation));
  });
}

export const RouterLive = Layer.of(
  Router,
  new Router({
    url: () => (landed() ? page.url : (loading?.url ?? page.url)),
    routeId: () => (landed() ? (page.route.id ?? undefined) : loading?.routeId),
    params: () => page.params,
    status: () => page.status,
    data: () => page.data as RouteData,
    goto: (href, options) => {
      if (!landed()) return Promise.reject(new Error('Router.goto before the first navigation landed'));
      const navigation = goto(href, options);
      gotos.add(navigation);
      void navigation.finally(() => gotos.delete(navigation));
      return navigation;
    },
    invalidate: afterNavigations,
    historyIndex,
    traverse: (delta) => history.go(delta),
    reload: () => location.reload(),
    load: (href, options) => (options.replace ? location.replace(href) : location.assign(href)),
    follow,
  }),
);

export const BrowserLive = Layer.mergeAll(PlatformLive, RouterLive);

type LoadData = Record<string, unknown> | void;

type LoadRun<E, T extends LoadData> = (event: E) => Generator<Ask, T | Promise<T>, unknown>;

type LoadEventLike = Pick<LoadEvent, 'parent' | 'depends' | 'url' | 'route' | 'untrack'> & { readonly data?: unknown };

function readSnapshot(app: MountedApp, ...sources: unknown[]): void {
  for (const source of sources) app.snapshot.apply(Snapshot.of(source));
}

function load<M extends LayerLike, L extends readonly AnyRung[], E extends LoadEventLike, T extends LoadData>(
  definition: Definition<M, L> & ClosedBy<M, typeof BrowserLive, L>,
  run: LoadRun<E, T>,
): (event: E) => Promise<T>;
function load<M extends LayerLike, L extends readonly AnyRung[], E extends LoadEventLike, T extends LoadData = void>(
  definition: Definition<M, L> & ClosedBy<M, typeof BrowserLive, L>,
  entry: Entry,
  run?: LoadRun<E, T>,
): (event: E) => Promise<T>;
function load<M extends LayerLike, L extends readonly AnyRung[], E extends LoadEventLike, T extends LoadData>(
  definition: Definition<M, L> & ClosedBy<M, typeof BrowserLive, L>,
  second: Entry | LoadRun<E, T>,
  third?: LoadRun<E, T>,
): (event: E) => Promise<T> {
  const entry = second instanceof Entry ? second : undefined;
  const run = second instanceof Entry ? third : second;
  return async (event) => {
    if (BROWSER && !landed()) loading = { url: event.url, routeId: (event.route.id ?? undefined) as RouteId | undefined };
    const app = BROWSER
      ? holdApp(definition, () => new MountedApp(definition, BrowserLive, worldHooks))
      : holdApp(definition, () => {
          throw new Error('No request app is open: the server hook opens one per request before any load runs');
        });

    for (const rung of definition.ladder) event.depends(rung.dependency);
    const fetching = entry?.prepare(app.app);
    fetching?.catch(() => undefined);
    const parent = await event.parent();
    if (BROWSER) readSnapshot(app, parent, event.data);
    else landApp({ ...(parent as object), ...(event.data as object) } as RouteData);

    if (entry) {
      await fetching;
      await app.enter(
        entry,
        event.untrack(() => event.route.id ?? undefined),
      );
    }
    const result = run ? await app.run(run(event)) : (undefined as T);
    if (BROWSER || currentApp(definition) !== app) return result;

    return { ...(result ?? {}), ...Snapshot.field(app.snapshot.take()) } as T;
  };
}

export const App = {
  ...SvelteApp,

  load,
} as const;
