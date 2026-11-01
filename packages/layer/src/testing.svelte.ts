import { reactiveCell } from '@runlith/roster/cell.svelte';
import { Point } from './Point.js';
import { Router, type RouteId, emptyRouteData } from './Router.js';
import { drawingAlone, type makePoint, type RouterAt } from './testing.js';

export function makeReactivePoint<Item>(key: Parameters<typeof makePoint<Item>>[0], ...items: readonly NoInfer<Item>[]): Point<Item> {
  const point = Point.over<Item>(key.id, key.definition, reactiveCell(), undefined, drawingAlone(key.definition));
  if (items.length > 0) point.register('test', ...items);
  return point;
}

export interface MovableRouter {
  router: Router;
  navigate(href: string, routeId?: RouteId): void;
}

export function makeMovableRouter(at: RouterAt = {}): MovableRouter {
  let url = $state(typeof at.url === 'function' ? at.url() : (at.url ?? new URL('http://localhost/')));
  let routeId = $state(at.routeId);

  const router = new Router({
    url: () => url,
    routeId: () => routeId,
    params: () => at.params ?? {},
    status: () => at.status ?? 200,
    data: () => at.data ?? emptyRouteData(),
    goto: at.goto ?? (async () => undefined),
    invalidate: at.invalidate ?? (async () => undefined),
    historyIndex: at.historyIndex ?? (() => undefined),
    traverse: at.traverse ?? (() => undefined),
    reload: at.reload ?? (() => undefined),
    load: at.load ?? (() => undefined),
  });

  return {
    router,
    navigate: (href, nextRouteId) => {
      url = new URL(href, url);
      routeId = nextRouteId;
    },
  };
}
