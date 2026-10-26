import type { Project } from '@tagma/server/graph/contract/wire/rows';
import { Platform, type PlatformStorage } from '@runlith/layer/Platform';
import { Service } from '@runlith/layer/key';
import { SvelteMap } from 'svelte/reactivity';
import { type Surface, SurfaceRegistry, withBranch } from './surface.js';

const STORAGE_KEY = 'tagma.visits';

type Visit = Record<string, string | null | undefined>;

export class Visits extends Service<Visits>()('Visits', { tier: 'app' }) {
  static *make() {
    const platform = yield* Platform;
    return new Visits(platform.storage.local, yield* SurfaceRegistry);
  }

  private readonly held = new SvelteMap<string, Visit>();

  constructor(
    private readonly storage: PlatformStorage,
    private readonly registry: SurfaceRegistry,
  ) {
    super();
    for (const [project, visit] of Object.entries(this.stored())) this.held.set(project, visit);
  }

  private stored(): Record<string, Visit> {
    try {
      return (JSON.parse(this.storage.getItem(STORAGE_KEY) ?? 'null') as Record<string, Visit> | null) ?? {};
    } catch {
      return {};
    }
  }

  knows(project: Project): boolean {
    return this.held.has(String(project.id));
  }

  placeOf(project: Project, surface: Surface): string | null {
    return this.held.get(String(project.id))?.[surface] ?? null;
  }

  branchOf(project: Project): string | null {
    return this.held.get(String(project.id))?.branch ?? null;
  }

  remember(project: Project, surface: Surface, place: string | null, branch: string | null): void {
    if (!this.registry.portable(surface)) return;
    const key = String(project.id);
    const remembers = this.registry.get(surface).remembers;
    const stored = this.stored();
    const visit = stored[key] ?? this.held.get(key) ?? {};
    if (visit.surface === surface && (visit.branch ?? null) === branch && (!remembers || (visit[surface] ?? null) === place)) return;
    const next = remembers ? { ...visit, [surface]: place, surface, branch } : { ...visit, surface, branch };
    this.held.set(key, next);
    const document = { ...Object.fromEntries(this.held), ...stored, [key]: next };
    this.storage.setItem(STORAGE_KEY, JSON.stringify(document));
  }

  href(project: Project, surface: Surface): string {
    return withBranch(this.registry.pathOf(project.name, surface, this.placeOf(project, surface)), this.branchOf(project));
  }

  resume(project: Project): string {
    const surface = this.held.get(String(project.id))?.surface;
    return this.href(project, surface != null && this.registry.portable(surface) ? surface : this.registry.home);
  }
}
