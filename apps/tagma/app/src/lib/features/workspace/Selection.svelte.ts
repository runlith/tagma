import type { Group, Project } from '@tagma/server/graph/contract/wire/rows';
import { Failure } from '@runlith/layer/Failure';
import { asRoutePathname, Router } from '@runlith/layer/Router';
import { Service } from '@runlith/layer/key';
import { renamedHref } from './address.js';
import { AppState, type AppStateStorage } from './AppState.js';
import { type Entry, EntryProject } from './EntryProject.js';
import { ProjectsRepo } from './ProjectsRepo.js';
import { Refusal } from '$lib/wire/refusal.js';

export const LAST_PROJECT_KEY = 'tagma.lastProjectId';

export class Workspace extends Service<Workspace>()('Workspace', { tier: 'app' }) {
  static *make() {
    return new Workspace(yield* ProjectsRepo, yield* Router, yield* AppState, yield* Failure, yield* EntryProject.optional());
  }

  projects = $state<readonly Project[]>([]);
  groups = $state.raw<readonly Group[]>([]);
  loaded = $state(false);
  readonly ready: Promise<void>;
  private remembered = $state<string | null>(null);
  private formerly = $state.raw<ReadonlyMap<string, number>>(new Map());
  private refreshing: Promise<void> | null = null;
  private asked = 0;
  private readonly byId = $derived(new Map(this.projects.map((project) => [project.id, project])));
  private readonly byMember = $derived(new Map(this.groups.flatMap((group) => group.members.map((member) => [member.id, group] as const))));
  private readonly byGraph = $derived(new Map(this.groups.map((group) => [group.graph.id, group] as const)));
  readonly contextId = $derived(this.contextProject?.id ?? null);
  readonly contextTile = $derived(this.contextProject === null ? null : this.tileOf(this.contextProject));
  private readonly sought = new Set<number>();

  constructor(
    private readonly repo: ProjectsRepo,
    private readonly router: Router,
    private readonly storage: AppStateStorage,
    private readonly failure: Failure,
    private readonly entry?: Entry,
  ) {
    super();
    this.remembered = storage.getItem(LAST_PROJECT_KEY);
    storage.watch(LAST_PROJECT_KEY, (value) => (this.remembered = value));
    this.ready = this.read();
    this.ready.catch((error: unknown) => this.failure.report(error));
  }

  get active(): Project | null {
    return this.named(this.router.params.project);
  }

  named(name: string | null | undefined): Project | null {
    if (name === null || name === undefined) return null;
    const held = this.projects.find((project) => project.name === name);
    if (held !== undefined) return held;
    const renamed = this.formerly.get(name);
    return renamed === undefined ? null : (this.byId.get(renamed) ?? null);
  }

  get activeId(): number | null {
    return this.active?.id ?? null;
  }

  get activeTileId(): number | null {
    const active = this.activeId;
    return active === null ? null : this.tileIdOf(active);
  }

  get contextProject(): Project | null {
    return this.active ?? this.entryProject();
  }

  get empty(): boolean {
    return this.loaded && this.projects.every((project) => project.kind !== 'folder');
  }

  entryProject(): Project | null {
    return (
      this.entered() ??
      this.projects.find((project) => String(project.id) === this.remembered) ??
      this.projects.find((project) => project.kind === 'folder') ??
      this.projects[0] ??
      null
    );
  }

  resumed(): Project | null {
    return this.entered() ?? (this.empty ? null : this.entryProject());
  }

  private entered(): Project | undefined {
    const entry = this.entry;
    return entry === undefined ? undefined : this.projects.find((project) => project.name === entry.project);
  }

  remember(project: Project): void {
    const id = String(project.id);
    if (!this.storage.ready || this.storage.getItem(LAST_PROJECT_KEY) === id) return;
    this.remembered = id;
    this.storage.setItem(LAST_PROJECT_KEY, id);
  }

  find(id: number): Project | null {
    const project = this.byId.get(id) ?? null;
    if (project === null && this.loaded && !this.sought.has(id)) {
      this.sought.add(id);
      queueMicrotask(() => void this.refreshProjects().catch((error: unknown) => this.failure.report(error)));
    }
    return project;
  }

  groupOf(projectId: number): Group | null {
    return this.byMember.get(projectId) ?? this.byGraph.get(projectId) ?? null;
  }

  tileOf(project: Project): Project {
    return this.byMember.get(project.id)?.graph ?? project;
  }

  tileIdOf(projectId: number): number {
    return this.byMember.get(projectId)?.graph.id ?? projectId;
  }

  markOf(home: number, standing: number): number | null {
    const first = this.byMember.get(standing)?.members[0]?.id ?? standing;
    return home === first ? null : home;
  }

  rootOf(id: number): string {
    return this.projects.find((project) => project.id === id)?.rootPath ?? '';
  }

  async nameOf(id: number): Promise<string> {
    const [project] = await this.projectsOf([id]);
    return project!.name;
  }

  async projectsOf(ids: readonly number[]): Promise<readonly Project[]> {
    if (ids.length === 0) return [];
    const held = new Map(this.projects.map((project) => [project.id, project]));
    if (ids.some((id) => !held.has(id))) {
      await this.refreshProjects();
      held.clear();
      for (const project of this.projects) held.set(project.id, project);
    }
    return ids.map((id) => {
      const project = held.get(id);
      if (project === undefined) {
        throw new Refusal({
          gate: false,
          code: 'unknown-project',
          reason: `project ${id} is not registered`,
          unblock: ['Read the project registry again'],
        });
      }
      return project;
    });
  }

  refreshProjects(): Promise<void> {
    this.asked += 1;
    if (this.refreshing !== null) return this.refreshing;
    const reading = this.reread().finally(() => {
      if (this.refreshing === reading) this.refreshing = null;
    });
    this.refreshing = reading;
    return reading;
  }

  private async reread(): Promise<void> {
    for (;;) {
      const asked = this.asked;
      const [projects, groups] = await Promise.all([
        this.repo.list.refresh({ throwOnError: true }),
        this.repo.groups.refresh({ throwOnError: true }),
      ]);
      if (projects !== undefined) this.adopt(projects, groups ?? this.groups);
      if (this.asked === asked) return;
    }
  }

  private async read(): Promise<void> {
    try {
      const [projects, groups] = await Promise.all([this.repo.list.loadOrThrow(), this.repo.groups.loadOrThrow()]);
      if (projects !== undefined) this.adopt(projects, groups ?? []);
    } finally {
      this.loaded = true;
    }
  }

  private adopt(projects: readonly Project[], groups: readonly Group[]): void {
    const before = this.byId;
    this.projects = projects;
    this.groups = groups;
    const renamed = new Map<string, Project>();
    for (const project of projects) {
      const was = before.get(project.id)?.name;
      if (was === undefined || was === project.name) continue;
      renamed.set(was, project);
      for (const [name, id] of this.formerly) if (id === project.id && name !== project.name) renamed.set(name, project);
    }
    const href = renamed.size === 0 ? null : renamedHref(this.router, new Map([...renamed].map(([was, project]) => [was, project.name])));
    if (href === null) return;
    this.formerly = new Map([...this.formerly, ...[...renamed].map(([was, project]) => [was, project.id] as const)]);
    this.router
      .replace(asRoutePathname(href))
      .catch((error: unknown) => this.failure.report(error))
      .finally(() => {
        const standing = [this.router.params.project, this.router.url.searchParams.get('project')];
        this.formerly = new Map([...this.formerly].filter(([name]) => standing.includes(name)));
      });
  }
}
