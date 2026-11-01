import { type Resolver, Service } from '@runlith/layer/key';
import type { Point } from '@runlith/layer/Point';
import { type ColumnDeclaration, type ColumnFrame, Columns, type ColumnState } from '$lib/features/workspace/column.js';
import { type RouteParams, type Surface, SurfaceRegistry } from '$lib/features/workspace/surface.js';

export type SectionColumn = {
  readonly id: string;
  readonly label: string;
  readonly open: boolean;
  readonly frame: ColumnFrame | undefined;
  readonly stands: 'tile' | 'page';
  readonly search: boolean;
  toggle(): void;
};

type ColumnIndex = {
  readonly byId: ReadonlyMap<string, ColumnDeclaration>;
  readonly byRoute: ReadonlyMap<string, ColumnDeclaration>;
};

const indexOf = (items: readonly ColumnDeclaration[]): ColumnIndex => ({
  byId: new Map(items.map((declaration) => [declaration.id, declaration])),
  byRoute: new Map(items.flatMap((declaration) => (declaration.routes ?? []).map((route) => [route, declaration] as const))),
});

export class ColumnRegistry extends Service<ColumnRegistry>()('ColumnRegistry', { tier: 'app' }) {
  static *make() {
    return new ColumnRegistry(yield* SurfaceRegistry, yield* Columns);
  }

  private readonly indexed: () => ColumnIndex;

  private readonly standing = new WeakMap<Resolver, WeakMap<ColumnDeclaration, SectionColumn>>();

  constructor(
    private readonly surfaces: SurfaceRegistry,
    columns: Point<ColumnDeclaration>,
  ) {
    super();
    this.indexed = columns.derive(indexOf);
  }

  private get index(): ColumnIndex {
    return this.indexed();
  }

  of(surface: Surface, app: Resolver): SectionColumn | null {
    const id = this.surfaces.columnOf(surface);
    return id === undefined ? null : this.column(this.index.byId.get(id), app);
  }

  at(routeId: string | undefined, params: RouteParams, inProject: boolean, app: Resolver): SectionColumn | null {
    if (inProject) return this.of(this.surfaces.of(routeId, params), app);
    return routeId === undefined ? null : this.column(this.index.byRoute.get(routeId), app);
  }

  private column(declaration: ColumnDeclaration | undefined, app: Resolver): SectionColumn | null {
    if (declaration === undefined || declaration.room?.(app) === false) return null;
    let held = this.standing.get(app);
    if (held === undefined) {
      held = new WeakMap();
      this.standing.set(app, held);
    }
    const kept = held.get(declaration);
    if (kept !== undefined) return kept;
    const state = (): ColumnState => app.resolve(declaration.state);
    const made: SectionColumn = {
      id: declaration.id,
      label: declaration.label,
      frame: declaration.frame,
      stands: declaration.stands ?? 'page',
      search: declaration.search ?? false,
      get open() {
        return state().open;
      },
      toggle: () => state().toggle(),
    };
    held.set(declaration, made);
    return made;
  }
}
