import { Service } from './key.js';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the extension point is empty until an app fills it.
export interface RouteTable {}

export type RoutePathname = RouteTable extends { pathname: infer Address extends string } ? Address : string;

export type RouteId = RouteTable extends { routeId: infer Id extends string } ? Id : string;

export type RouteData = (RouteTable extends { data: infer Data extends object } ? Data : object) & Record<string, unknown>;

export function asRoutePathname(value: string): RoutePathname {
  return value as RoutePathname;
}

export function emptyRouteData(): RouteData {
  return {} as RouteData;
}

export interface RouterGoOptions {
  replaceState?: boolean;
  keepFocus?: boolean;
  noScroll?: boolean;
  invalidateAll?: boolean;
}

export interface RouterLoadOptions {
  replace?: boolean;
}

export type NavigationType = 'enter' | 'form' | 'leave' | 'link' | 'goto' | 'popstate';

export interface NavigationPlace {
  readonly url: URL;
  readonly routeId: RouteId | undefined;
  readonly params: Record<string, string>;
}

export interface Navigation {
  readonly type: NavigationType;
  readonly from: NavigationPlace | null;
  readonly to: NavigationPlace | null;
}

export interface NavigationListener {
  before?(navigation: Navigation): void;
  after?(navigation: Navigation): void;
}

export interface HistoryReach {
  readonly back: boolean;
  readonly forward: boolean;
}

const UNREACHED: HistoryReach = { back: false, forward: false };

export interface RouterSource {
  url(): URL;
  routeId(): RouteId | undefined;
  params(): Record<string, string>;
  status(): number;
  data(): RouteData;
  goto(href: RoutePathname, options?: RouterGoOptions): Promise<void>;
  invalidate(dependency: string): Promise<void>;
  historyIndex(): number | undefined;
  reach?(): HistoryReach;
  traverse(delta: number): void;
  reload(): void;
  load(href: string, options: RouterLoadOptions): void;
  follow?(listener: Required<NavigationListener>): void;
}

export class Router extends Service<Router>()('Router', { tier: 'app' }) {
  private readonly listeners = new Set<NavigationListener>();

  constructor(private readonly source: RouterSource) {
    super();
  }

  get url(): URL {
    return this.source.url();
  }

  get pathname(): string {
    return this.source.url().pathname;
  }

  get routeId(): RouteId | undefined {
    return this.source.routeId();
  }

  get params(): Record<string, string> {
    return this.source.params();
  }

  get status(): number {
    return this.source.status();
  }

  get data(): RouteData {
    return this.source.data();
  }

  goto(href: RoutePathname, options?: RouterGoOptions): Promise<void> {
    return this.source.goto(href, options);
  }

  replace(href: RoutePathname): Promise<void> {
    return this.source.goto(href, { replaceState: true, keepFocus: true, noScroll: true });
  }

  invalidate(dependency: string): Promise<void> {
    return this.source.invalidate(dependency);
  }

  get historyIndex(): number | undefined {
    return this.source.historyIndex();
  }

  get reach(): HistoryReach {
    return this.source.reach?.() ?? UNREACHED;
  }

  traverse(delta: number): void {
    this.source.traverse(delta);
  }

  reload(): void {
    this.source.reload();
  }

  load(href: string, options: RouterLoadOptions = {}): void {
    this.source.load(href, options);
  }

  onNavigate(listener: NavigationListener): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  attach(): void {
    this.source.follow?.({
      before: (navigation) => {
        for (const listener of [...this.listeners]) listener.before?.(navigation);
      },
      after: (navigation) => {
        for (const listener of [...this.listeners]) listener.after?.(navigation);
      },
    });
  }
}
