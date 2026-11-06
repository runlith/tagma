import { Router } from '@runlith/layer/Router';
import { type Resolver, Service } from '@runlith/layer/key';
import type { Point } from '@runlith/layer/Point';
import type { Origin, Runner } from '$lib/app/keys/ports.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { type Action, type ActionEnv, type ActionSet, Actions, type Listed } from '$lib/features/workspace/action.js';
import { projectOpen } from '$lib/features/workspace/address.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { SurfaceRegistry } from '$lib/features/workspace/surface.js';

export class ActionRegistry extends Service<ActionRegistry>()('ActionRegistry', { tier: 'app' }) implements Runner {
  static *make() {
    return new ActionRegistry(yield* Actions, yield* Workspace, yield* Router, yield* SurfaceRegistry, yield* Notices);
  }

  private app = $state.raw<Resolver | null>(null);

  constructor(
    private readonly sets: Point<ActionSet>,
    private readonly workspace: Workspace,
    private readonly router: Router,
    private readonly surfaces: SurfaceRegistry,
    private readonly notices: Notices,
  ) {
    super();
  }

  attach(app: Resolver): () => void {
    this.app = app;
    return () => {
      if (this.app === app) this.app = null;
    };
  }

  get listed(): readonly Listed[] {
    const app = this.app;
    return this.sets.items.flatMap(({ area, actions }) =>
      (typeof actions === 'function' ? (app === null ? [] : actions(app)) : actions).map((action) => ({ area, action })),
    );
  }

  of(): readonly Action[] {
    return this.listed
      .map(({ action }) => action)
      .filter((action) => action.palette !== false && action.region === undefined && action.run !== undefined)
      .sort((left, right) => (left.order ?? 100) - (right.order ?? 100));
  }

  env(): ActionEnv {
    const app = this.app;
    return {
      project: this.workspace.contextProject,
      routeProject: projectOpen(this.router) ? (this.router.params.project ?? null) : null,
      surface: projectOpen(this.router) ? this.surfaces.of(this.router.routeId, this.router.params) : null,
      goto: (href) => void this.router.goto(href),
      resolve: (key) => {
        if (app === null) throw new Error('An action ran before the window shell attached its resolver');
        return app.resolve(key);
      },
    };
  }

  owns(id: string): boolean {
    return this.find(id)?.run !== undefined;
  }

  run(id: string, _origin: Origin): boolean {
    const action = this.find(id);
    if (action?.run === undefined || this.app === null) return false;
    const env = this.env();
    if (!(action.available?.(env) ?? true) || (action.disabled?.(env) ?? false)) return false;
    void Promise.resolve()
      .then(() => action.run?.(env))
      .catch((error: unknown) => this.notices.refusal(error));
    return true;
  }

  private find(id: string): Action | undefined {
    return this.listed.find(({ action }) => action.id === id)?.action;
  }
}
