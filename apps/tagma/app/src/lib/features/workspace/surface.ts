import type { Project } from '@tagma/server/graph/contract/wire/rows';
import { RegistryClash, clashOf } from '@runlith/chat-ui/RegistryClash';
import { Service } from '@runlith/layer/key';
import type { Component, Snippet } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';

export type Surface = string;

export const CHAT: Surface = 'chat';

export const CHECKOUT: Surface = 'checkout';

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
  readonly phone?: true;
};

export type SurfaceMark = Component<{ project: Project; children: Snippet }>;

export type RouteParams = Readonly<Record<string, string | undefined>>;

export type SurfacesModule = { readonly surfaces: readonly SurfaceDeclaration[] };

const RESERVED: readonly string[] = ['branch', 'surface'];

export const withBranch = (path: string, branch: string | null): string =>
  branch === null ? path : `${path}?branch=${encodeURIComponent(branch)}`;

const memberRoute = (routeId: string, params: RouteParams): string | null => {
  const parts: string[] = [];
  for (const segment of routeId.split('/').slice(2)) {
    const named = /^\[+([^\]]+)\]+$/u.exec(segment)?.[1];
    const value = named === undefined ? segment : params[named];
    if (value === undefined || value === '') return null;
    parts.push(value);
  }
  return parts.join('/');
};

export class SurfaceRegistry extends Service<SurfaceRegistry>()('SurfaceRegistry', { tier: 'app' }) {
  readonly home: Surface;
  readonly root: Surface;

  private readonly fixed: readonly SurfaceDeclaration[];
  private readonly fixedRail: readonly SurfaceDeclaration[];
  private readonly bySurface = new Map<Surface, SurfaceDeclaration>();
  private readonly former = new Map<Surface, Surface>();
  private readonly byRoute = new Map<string, SurfaceDeclaration>();
  private readonly members = new SvelteMap<Surface, SurfaceDeclaration>();
  private readonly memberRoutes = new SvelteMap<string, SurfaceDeclaration>();

  constructor(declarations: readonly SurfaceDeclaration[]) {
    super();
    for (const declaration of declarations) {
      if (RESERVED.includes(declaration.surface)) {
        throw new RegistryClash({
          message: `Surface "${declaration.surface}" is a name the visit record keeps for itself.`,
          holders: [declaration.surface],
        });
      }
      if (this.bySurface.has(declaration.surface)) {
        throw new RegistryClash({ message: `Surface "${declaration.surface}" is declared twice.`, holders: [declaration.surface] });
      }
      this.bySurface.set(declaration.surface, declaration);
      for (const route of [declaration.route, ...(declaration.place === undefined ? [] : [declaration.place])]) {
        const claimant = this.byRoute.get(route);
        if (claimant !== undefined) throw clashOf(`Route "${route}"`, claimant.surface, declaration.surface);
        this.byRoute.set(route, declaration);
      }
    }
    for (const declaration of declarations) {
      if (declaration.formerly !== undefined) {
        const holder = this.bySurface.get(declaration.formerly)?.surface ?? this.former.get(declaration.formerly);
        if (holder !== undefined) throw clashOf(`Surface "${declaration.formerly}"`, holder, declaration.surface);
        this.former.set(declaration.formerly, declaration.surface);
      }
      if (declaration.under !== undefined && !this.bySurface.has(declaration.under)) {
        throw new RegistryClash({
          message: `Surface "${declaration.surface}" stands under "${declaration.under}", which is not declared.`,
          holders: [declaration.surface],
        });
      }
    }
    const homes = declarations.filter((one) => one.home === true);
    if (declarations.length > 0 && homes.length !== 1) {
      throw new RegistryClash({
        message: `Exactly one surface is the home, ${homes.length} declare it.`,
        holders: homes.map((one) => one.surface),
      });
    }
    const home = homes[0];
    if (home !== undefined && home.rail === undefined) {
      throw new RegistryClash({ message: `The home surface "${home.surface}" has no place in the rail.`, holders: [home.surface] });
    }
    this.fixed = declarations;
    this.fixedRail = declarations.filter((one) => one.rail !== undefined).toSorted((left, right) => (left.rail ?? 0) - (right.rail ?? 0));
    this.home = home?.surface ?? '';
    this.root = this.byRoute.get('')?.surface ?? this.home;
  }

  get declared(): readonly SurfaceDeclaration[] {
    return this.fixed;
  }

  get all(): readonly SurfaceDeclaration[] {
    return this.members.size === 0 ? this.fixed : [...this.fixed, ...this.members.values()];
  }

  get rail(): readonly SurfaceDeclaration[] {
    if (this.members.size === 0) return this.fixedRail;
    const placed = [...this.members.values()].filter((one) => one.rail !== undefined);
    return [...this.fixedRail, ...placed].toSorted((left, right) => (left.rail ?? 0) - (right.rail ?? 0));
  }

  register(declaration: SurfaceDeclaration): () => void {
    if (this.bySurface.has(declaration.surface) || this.members.has(declaration.surface)) {
      throw new RegistryClash({ message: `Surface "${declaration.surface}" is declared twice.`, holders: [declaration.surface] });
    }
    const claimant = this.byRoute.get(declaration.route) ?? this.memberRoutes.get(declaration.route);
    if (claimant !== undefined) throw clashOf(`Route "${declaration.route}"`, claimant.surface, declaration.surface);
    this.members.set(declaration.surface, declaration);
    this.memberRoutes.set(declaration.route, declaration);
    return () => {
      if (this.members.get(declaration.surface) !== declaration) return;
      this.members.delete(declaration.surface);
      this.memberRoutes.delete(declaration.route);
    };
  }

  named(stored: string): Surface {
    const cut = stored.indexOf('/');
    const head = cut === -1 ? stored : stored.slice(0, cut);
    const now = this.former.get(head);
    return now === undefined ? stored : `${now}${stored.slice(head.length)}`;
  }

  portable(surface: Surface): boolean {
    const declared = this.bySurface.get(surface);
    return declared !== undefined && declared.nested !== true;
  }

  find(surface: Surface): SurfaceDeclaration | undefined {
    return this.bySurface.get(surface) ?? this.members.get(surface);
  }

  get(surface: Surface): SurfaceDeclaration {
    const declared = this.find(surface);
    if (declared === undefined) throw new Error(`Surface "${surface}" is not declared.`);
    return declared;
  }

  of(routeId: string | null | undefined, params?: RouteParams): Surface {
    const route = routeId?.split('/')[2] ?? '';
    const fixed = this.byRoute.get(route) ?? this.byRoute.get('');
    if (fixed?.nested === true && routeId != null && params !== undefined) {
      const wanted = memberRoute(routeId, params);
      const member = wanted === null ? undefined : this.memberRoutes.get(wanted);
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
    return (this.byRoute.get(route) ?? this.memberRoutes.get(route))?.surface;
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
