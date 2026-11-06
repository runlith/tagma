import { Router } from '@runlith/layer/Router';
import { type Resolver, Service } from '@runlith/layer/key';
import type { Point } from '@runlith/layer/Point';
import type { Origin, Runner } from '$lib/app/keys/ports.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { type Action, type ActionEnv, type ActionSet, Actions, type Catalog, type Listed } from '$lib/features/workspace/action.js';
import { projectOpen } from '$lib/features/workspace/address.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { SurfaceRegistry } from '$lib/features/workspace/surface.js';

type Indexed = { readonly listed: readonly Listed[]; readonly byId: ReadonlyMap<string, Action> };

const indexOf = (sets: readonly ActionSet[]): Indexed => {
  const listed = sets.flatMap(({ area, actions }) =>
    (typeof actions === 'function' ? actions() : actions).map((action) => ({ area, action })),
  );
  const byId = new Map<string, Action>();
  for (const { action } of listed) {
    if (byId.has(action.id)) throw new Error(`Two actions are named "${action.id}"`);
    byId.set(action.id, action);
  }
  return { listed, byId };
};

export class ActionRegistry extends Service<ActionRegistry>()('ActionRegistry', { tier: 'app' }) implements Runner, Catalog {
  static *make() {
    return new ActionRegistry(yield* Actions, yield* Workspace, yield* Router, yield* SurfaceRegistry, yield* Notices);
  }

  private app = $state.raw<Resolver | null>(null);
  private readonly index = $derived.by(() => indexOf(this.sets.items));

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
    return this.index.listed;
  }

  get settled(): boolean {
    return this.sets.items.every((set) => set.settled?.() ?? true);
  }

  titleOf(id: string): string {
    return this.index.byId.get(id)?.title ?? id;
  }

  of(): readonly Action[] {
    return this.listed
      .map(({ action }) => action)
      .filter((action) => action.palette !== false && action.region === undefined)
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
    const action = this.index.byId.get(id);
    return action !== undefined && (action.run !== undefined || action.claims === true);
  }

  run(id: string, _origin: Origin): boolean {
    const action = this.index.byId.get(id);
    if (action?.run === undefined || this.app === null) return false;
    const env = this.env();
    if (!(action.available?.(env) ?? true) || (action.disabled?.(env) ?? false)) return false;
    void Promise.resolve()
      .then(() => action.run?.(env))
      .catch((error: unknown) => this.notices.refusal(error));
    return true;
  }
}
