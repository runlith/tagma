import { isBlockName } from '@tagma/server/graph/contract/wire/references';
import type { Project } from '@tagma/server/graph/contract/wire/rows';
import { Service } from '@runlith/layer/key';
import { Router } from '@runlith/layer/Router';
import { type BlockLens, carriedQuery, currentProject, type GitView } from './address.js';
import { labelOf } from './mark.js';
import { CHAT, CHECKOUT, type Surface, SurfaceRegistry, withBranch } from './surface.js';

export type BlockAim = BlockLens & { readonly project?: string; readonly branch?: string | null };

export class Addresses extends Service<Addresses>()('Addresses', { tier: 'app' }) {
  static *make() {
    return new Addresses(yield* Router, yield* SurfaceRegistry);
  }

  constructor(
    private readonly router: Router,
    private readonly surfaces: SurfaceRegistry,
  ) {
    super();
  }

  project(project: string, surface: Surface = this.surfaces.root): string {
    return `${this.surfaces.pathOf(project, surface)}${carriedQuery(this.router, project)}`;
  }

  surface(surface: Surface, project: string = currentProject(this.router)): string {
    return this.project(project, surface);
  }

  place(project: string, surface: Surface, place: string | null, branch: string | null): string {
    return withBranch(this.surfaces.pathOf(project, surface, place), branch);
  }

  scoped(surface: Surface, blockName: string, project: string = currentProject(this.router)): string {
    return `${this.surfaces.pathOf(project, surface)}/${blockName}${carriedQuery(this.router, project)}`;
  }

  block(name: string, options: BlockAim = {}): string {
    const project = options.project ?? currentProject(this.router);
    return `${this.surfaces.pathOf(project, this.surfaces.root, name)}${carriedQuery(this.router, project, options, options.branch)}`;
  }

  thread(sessionId: string | null, project: string = currentProject(this.router)): string {
    const base = this.surfaces.pathOf(project, CHAT);
    const query = carriedQuery(this.router, project);
    return sessionId === null ? `${base}${query}` : `${base}/${encodeURIComponent(sessionId)}${query}`;
  }

  terminal(key: string, project: string = currentProject(this.router)): string {
    const params = new URLSearchParams(carriedQuery(this.router, project).slice(1));
    params.set('terminal', key);
    const agents = project === currentProject(this.router) && this.surfaces.of(this.router.routeId) === CHAT;
    return `${agents ? this.router.pathname : this.surfaces.pathOf(project, CHAT)}?${params.toString()}`;
  }

  commit(commit: string, project: string = currentProject(this.router)): string {
    const params = new URLSearchParams(carriedQuery(this.router, project).slice(1));
    params.set('commit', commit);
    return `${this.surfaces.pathOf(project, CHECKOUT)}?${params.toString()}`;
  }

  git(view: GitView, branch: string | null, project: string = currentProject(this.router)): string {
    const params = new URLSearchParams();
    if (branch !== null) params.set('branch', branch);
    params.set('view', view);
    return `${this.surfaces.pathOf(project, CHECKOUT)}?${params.toString()}`;
  }

  title(project: Project | null): string {
    const label = project === null ? currentProject(this.router) : labelOf(project);
    return `${label} · ${this.surfaces.get(this.surfaces.of(this.router.routeId, this.router.params)).label}`;
  }

  get scope(): string | null {
    const id = this.router.params.id;
    const name = typeof id === 'string' ? id.toLowerCase() : undefined;
    const route = this.router.routeId;
    const scoped = route !== undefined && this.surfaces.get(this.surfaces.of(route)).scoped === true;
    return scoped && name !== undefined && isBlockName(name) ? name : null;
  }
}
