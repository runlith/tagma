import { RegistryClash, clashOf } from '@runlith/chat-ui/RegistryClash';
import { type Resolver, Service } from '@runlith/layer/key';
import type { ColumnDeclaration, ColumnFrame } from '$lib/features/workspace/column.js';
import type { Surface, SurfaceRegistry } from '$lib/features/workspace/surface.js';

export type SectionColumn = {
  readonly id: string;
  readonly label: string;
  readonly open: boolean;
  readonly frame: ColumnFrame | undefined;
  readonly search: boolean;
  toggle(): void;
};

export class ColumnRegistry extends Service<ColumnRegistry>()('ColumnRegistry', { tier: 'app' }) {
  private readonly byId = new Map<string, ColumnDeclaration>();

  private readonly byRoute = new Map<string, ColumnDeclaration>();

  private readonly standing = new WeakMap<Resolver, Map<string, SectionColumn>>();

  constructor(
    private readonly surfaces: SurfaceRegistry,
    declarations: readonly ColumnDeclaration[],
  ) {
    super();
    for (const declaration of declarations) {
      const held = this.byId.get(declaration.id);
      if (held !== undefined) throw clashOf(`Column "${declaration.id}"`, held.id, declaration.id);
      this.byId.set(declaration.id, declaration);
      for (const route of declaration.routes ?? []) {
        const claimant = this.byRoute.get(route);
        if (claimant !== undefined) throw clashOf(`Route "${route}"`, claimant.id, declaration.id);
        this.byRoute.set(route, declaration);
      }
    }
    for (const surface of surfaces.all) {
      const id = surfaces.columnOf(surface.surface);
      if (id !== undefined && !this.byId.has(id)) {
        throw new RegistryClash({
          message: `Surface "${surface.surface}" names the column "${id}", which no feature declares.`,
          holders: [surface.surface],
        });
      }
    }
  }

  of(surface: Surface, app: Resolver): SectionColumn | null {
    const id = this.surfaces.columnOf(surface);
    return id === undefined ? null : this.column(this.byId.get(id), app);
  }

  at(routeId: string | undefined, inProject: boolean, app: Resolver): SectionColumn | null {
    if (inProject) return this.of(this.surfaces.of(routeId), app);
    return routeId === undefined ? null : this.column(this.byRoute.get(routeId), app);
  }

  private column(declaration: ColumnDeclaration | undefined, app: Resolver): SectionColumn | null {
    if (declaration === undefined || declaration.room?.(app) === false) return null;
    let held = this.standing.get(app);
    if (held === undefined) {
      held = new Map();
      this.standing.set(app, held);
    }
    const kept = held.get(declaration.id);
    if (kept !== undefined) return kept;
    const state = app.resolve(declaration.state);
    const made: SectionColumn = {
      id: declaration.id,
      label: declaration.label,
      frame: declaration.frame,
      search: declaration.search ?? false,
      get open() {
        return state.open;
      },
      toggle: () => state.toggle(),
    };
    held.set(declaration.id, made);
    return made;
  }
}
