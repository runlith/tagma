import type { Project } from '@tagma/server/graph/contract/wire/rows';
import { Service } from '@runlith/layer/key';
import { Point } from '@runlith/layer/Point';
import type { Shown } from '@runlith/layer/svelte/payload';
import type { Component, Snippet } from 'svelte';

export type Surface = string;

export const CHAT: Surface = 'chat';

export const CHECKOUT: Surface = 'checkout';

export const CONTRIBUTED_ROUTE = 'p';

export type SurfaceProps = { readonly path: string };

type SurfaceView = { readonly tagmaApp: string; readonly view: string };

type SurfacePayload = Shown<SurfaceProps, SurfaceView>['payload'];

export type SurfaceDeclaration = {
  readonly surface: Surface;
  readonly formerly?: Surface;
  readonly route: string;
  readonly place?: string;
  readonly label: string;
  readonly icon: Component<{ class?: string }>;
  readonly mark?: SurfaceMark;
  readonly rail?: number;
  readonly pinned?: true;
  readonly under?: Surface;
  readonly home?: true;
  readonly stands: 'project' | 'graph';
  readonly column?: string;
  readonly remembers: boolean;
  readonly scoped?: true;
  readonly iconUrl?: string;
  readonly nested?: true;
  readonly within?: Surface;
  readonly payload?: SurfacePayload;
  readonly phone?: true;
};

export type SurfaceMark = Component<{ project: Project; children: Snippet }>;

export type RouteParams = Readonly<Record<string, string | undefined>>;

const RESERVED: readonly string[] = ['branch', 'surface'];

const contributed = (route: string): boolean => route.startsWith(`${CONTRIBUTED_ROUTE}/`);

const admitsOf = (declaration: SurfaceDeclaration): string | null => {
  if (RESERVED.includes(declaration.surface)) return 'the visit record keeps this name for itself';
  const served = declaration.route === CONTRIBUTED_ROUTE || contributed(declaration.route);
  if (declaration.payload !== undefined && !served) return `a surface carrying its page stands under the "${CONTRIBUTED_ROUTE}" route`;
  if (contributed(declaration.route) && (declaration.payload === undefined || declaration.place !== undefined)) {
    return `a surface under the "${CONTRIBUTED_ROUTE}" route carries its page and keeps no place directory`;
  }
  if (declaration.home === true && declaration.rail === undefined) return 'the home surface has no place in the rail';
  if (
    declaration.within !== undefined &&
    (declaration.home === true || declaration.formerly !== undefined || declaration.place !== undefined)
  ) {
    return 'a view within another surface is never the home, has no former name and no place directory';
  }
  return null;
};

const claimsOf = (declaration: SurfaceDeclaration): readonly string[] => {
  return [
    `Surface "${declaration.surface}"`,
    ...(declaration.formerly === undefined ? [] : [`Surface "${declaration.formerly}"`]),
    `Route "${declaration.route}"`,
    ...(declaration.place === undefined ? [] : [`Route "${declaration.place}"`]),
    ...(declaration.home === true ? ['The home surface'] : []),
  ];
};

export const Surfaces = Point.define<SurfaceDeclaration>()('Surfaces', {
  tier: 'app',
  key: (declaration) => declaration.surface,
  admits: admitsOf,
  claims: claimsOf,
});

type SurfaceIndex = {
  readonly items: readonly SurfaceDeclaration[];
  readonly declared: readonly SurfaceDeclaration[];
  readonly bySurface: ReadonlyMap<Surface, SurfaceDeclaration>;
  readonly former: ReadonlyMap<Surface, Surface>;
  readonly byRoute: ReadonlyMap<string, SurfaceDeclaration>;
  readonly memberRoutes: ReadonlyMap<string, SurfaceDeclaration>;
  readonly rail: readonly SurfaceDeclaration[];
  readonly home: Surface;
};

const indexOf = (items: readonly SurfaceDeclaration[]): SurfaceIndex => {
  const declared = items.filter((one) => one.within === undefined);
  const bySurface = new Map<Surface, SurfaceDeclaration>();
  const former = new Map<Surface, Surface>();
  const byRoute = new Map<string, SurfaceDeclaration>();
  const memberRoutes = new Map<string, SurfaceDeclaration>();
  for (const declaration of items) {
    bySurface.set(declaration.surface, declaration);
    if (declaration.formerly !== undefined) former.set(declaration.formerly, declaration.surface);
    if (contributed(declaration.route)) {
      memberRoutes.set(declaration.route, declaration);
      continue;
    }
    byRoute.set(declaration.route, declaration);
    if (declaration.place !== undefined) byRoute.set(declaration.place, declaration);
  }
  return {
    items,
    declared,
    bySurface,
    former,
    byRoute,
    memberRoutes,
    rail: items.filter((one) => one.rail !== undefined).toSorted((left, right) => (left.rail ?? 0) - (right.rail ?? 0)),
    home: declared.find((one) => one.home === true)?.surface ?? declared.find((one) => one.rail !== undefined)?.surface ?? '',
  };
};

export const withBranch = (path: string, branch: string | null): string =>
  branch === null ? path : `${path}?branch=${encodeURIComponent(branch)}`;

const memberRoute = (routeId: string, params: RouteParams): string | null => {
  const parts: string[] = [];
  for (const segment of routeId.split('/').slice(2)) {
    const named = /^\[+(?:\.\.\.)?([^\]]+)\]+$/u.exec(segment)?.[1];
    const value = named === undefined ? segment : params[named];
    if (value === undefined || value === '') return null;
    parts.push(value);
  }
  return parts.join('/');
};

export class SurfaceRegistry extends Service<SurfaceRegistry>()('SurfaceRegistry', { tier: 'app' }) {
  static *make() {
    return new SurfaceRegistry(yield* Surfaces);
  }

  private readonly indexed: () => SurfaceIndex;

  constructor(surfaces: Point<SurfaceDeclaration>) {
    super();
    this.indexed = surfaces.derive(indexOf);
  }

  private get index(): SurfaceIndex {
    return this.indexed();
  }

  private get bySurface(): ReadonlyMap<Surface, SurfaceDeclaration> {
    return this.index.bySurface;
  }

  private get byRoute(): ReadonlyMap<string, SurfaceDeclaration> {
    return this.index.byRoute;
  }

  get home(): Surface {
    return this.index.home;
  }

  get root(): Surface {
    return this.byRoute.get('')?.surface ?? this.home;
  }

  get declared(): readonly SurfaceDeclaration[] {
    return this.index.declared;
  }

  get all(): readonly SurfaceDeclaration[] {
    return this.index.items;
  }

  get rail(): readonly SurfaceDeclaration[] {
    return this.index.rail;
  }

  named(stored: string): Surface {
    const cut = stored.indexOf('/');
    const head = cut === -1 ? stored : stored.slice(0, cut);
    const now = this.index.former.get(head);
    return now === undefined ? stored : `${now}${stored.slice(head.length)}`;
  }

  portable(surface: Surface): boolean {
    const declared = this.bySurface.get(surface);
    return declared !== undefined && declared.nested !== true && declared.within === undefined;
  }

  find(surface: Surface): SurfaceDeclaration | undefined {
    return this.bySurface.get(surface);
  }

  get(surface: Surface): SurfaceDeclaration {
    const declared = this.find(surface);
    if (declared === undefined) throw new Error(`Surface "${surface}" is not declared.`);
    return declared;
  }

  of(routeId: string | null | undefined, params: RouteParams): Surface {
    const route = routeId?.split('/')[2] ?? '';
    const fixed = this.byRoute.get(route) ?? this.byRoute.get('');
    if (route === CONTRIBUTED_ROUTE && routeId != null) {
      const wanted = memberRoute(routeId, params);
      const member = wanted === null ? undefined : this.index.memberRoutes.get(wanted);
      if (member !== undefined) return member.surface;
    }
    return fixed?.surface ?? this.home;
  }

  pathOf(project: string, surface: Surface, place: string | null = null): string {
    const declared = this.get(surface);
    const base = `/${encodeURIComponent(project)}`;
    if (place === null) return declared.route === '' ? base : `${base}/${declared.route}`;
    const segment = declared.place ?? declared.route;
    return segment === '' ? `${base}/${encodeURIComponent(place)}` : `${base}/${segment}/${encodeURIComponent(place)}`;
  }

  owner(route: string): Surface | undefined {
    return (this.byRoute.get(route) ?? this.index.memberRoutes.get(route))?.surface;
  }

  get routes(): readonly string[] {
    return [...this.byRoute.keys()];
  }

  railOf(surface: Surface): Surface {
    return this.find(surface)?.under ?? surface;
  }

  columnOf(surface: Surface): string | undefined {
    const declared = this.find(surface);
    if (declared === undefined) return undefined;
    return declared.column ?? (declared.under === undefined ? undefined : this.columnOf(declared.under));
  }
}
