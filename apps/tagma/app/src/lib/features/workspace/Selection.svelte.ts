import type { Project } from '@tagma/server/graph/contract/wire/rows';
import { Failure } from '@runlith/layer/Failure';
import { Platform } from '@runlith/layer/Platform';
import { Router } from '@runlith/layer/Router';
import { Service } from '@runlith/layer/key';
import { type Entry, EntryProject } from './EntryProject.js';
import { ProjectsRepo } from './ProjectsRepo.js';
import { Refusal } from '$lib/wire/refusal.js';

const LAST_PROJECT_KEY = 'tagma.lastProject';

type Projects = ReturnType<typeof ProjectsRepo.use>;

export class Workspace extends Service<Workspace>()('Workspace', { tier: 'app' }) {
  static *make() {
    return new Workspace(yield* ProjectsRepo, yield* Router, yield* Platform, yield* Failure, yield* EntryProject.optional());
  }

  projects = $state<readonly Project[]>([]);
  loaded = $state(false);
  readonly ready: Promise<void>;
  private remembered = $state<string | null>(null);
  private refreshing: Promise<void> | null = null;
  private readonly byId = $derived(new Map(this.projects.map((project) => [project.id, project])));
  readonly contextId = $derived(this.contextProject?.id ?? null);
  private readonly sought = new Set<number>();

  constructor(
    private readonly repo: Projects,
    private readonly router: Router,
    private readonly platform: Platform,
    private readonly failure: Failure,
    private readonly entry?: Entry,
  ) {
    super();
    this.remembered = platform.storage.local.getItem(LAST_PROJECT_KEY);
    this.ready = this.read();
    this.ready.catch((error: unknown) => this.failure.report(error));
  }

  get active(): Project | null {
    const name = this.router.params.project;
    return this.projects.find((project) => project.name === name) ?? null;
  }

  get activeId(): number | null {
    return this.active?.id ?? null;
  }

  get contextProject(): Project | null {
    return this.active ?? this.entryProject();
  }

  get empty(): boolean {
    return this.loaded && this.projects.every((project) => project.global);
  }

  entryProject(): Project | null {
    return (
      this.named() ??
      this.projects.find((project) => project.name === this.remembered) ??
      this.projects.find((project) => !project.global) ??
      this.projects[0] ??
      null
    );
  }

  resumed(): Project | null {
    return this.named() ?? (this.empty ? null : this.entryProject());
  }

  private named(): Project | undefined {
    const entry = this.entry;
    return entry === undefined ? undefined : this.projects.find((project) => project.name === entry.project);
  }

  remember(name: string): void {
    this.remembered = name;
    this.platform.storage.local.setItem(LAST_PROJECT_KEY, name);
  }

  find(id: number): Project | null {
    const project = this.byId.get(id) ?? null;
    if (project === null && this.loaded && !this.sought.has(id)) {
      this.sought.add(id);
      queueMicrotask(() => void this.refreshProjects().catch((error: unknown) => this.failure.report(error)));
    }
    return project;
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
    if (this.refreshing !== null) return this.refreshing;
    const reading = this.repo.list.refresh({ throwOnError: true }).then((projects) => {
      if (projects !== undefined) this.projects = projects;
    });
    this.refreshing = reading;
    return reading.finally(() => {
      if (this.refreshing === reading) this.refreshing = null;
    });
  }

  private async read(): Promise<void> {
    try {
      const projects = await this.repo.list.loadOrThrow();
      if (projects !== undefined) this.projects = projects;
    } finally {
      this.loaded = true;
    }
  }
}
