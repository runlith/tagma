import { Service } from '@runlith/layer/key';
import { Router } from '@runlith/layer/Router';
import type { DesktopFolders as Bridge } from '@tagma/desktop/bridge';
import type { StorageMode } from '@tagma/server/projects/contract/wire/project';
import type { Told } from '$lib/wire/told.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { labelOf } from '$lib/features/workspace/mark.js';
import { Addresses } from '$lib/features/workspace/Addresses.js';
import { ProjectsRepo } from '$lib/features/workspace/ProjectsRepo.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { SurfaceRegistry } from '$lib/features/workspace/surface.js';
import { Refusal, toldOf } from '$lib/wire/refusal.js';
import { ProjectRemoval } from '$lib/features/projects/Removal.svelte.js';
import { DesktopFolders } from '$lib/shared/desktop/DesktopFolders.js';

export type ProjectDraft = {
  readonly name: string;
  readonly rootPath: string;
  readonly storage?: StorageMode;
  readonly catalogs?: readonly string[];
  readonly contributed?: Readonly<Record<string, unknown>>;
};

export type Refused = { readonly told: Told; readonly field?: string };

export const refusedOf = (error: unknown): Refused => ({ told: toldOf(error), field: error instanceof Refusal ? error.field : undefined });

export type Offered = { readonly name: string; readonly rootPath: string; readonly refused: Refused };

export const folderName = (path: string): string =>
  path
    .split(/[/\\]/)
    .filter((part) => part !== '')
    .at(-1) ?? path;

export class ProjectCreation extends Service<ProjectCreation>()('ProjectCreation', { tier: 'app' }) {
  static *make() {
    return new ProjectCreation(
      yield* ProjectsRepo,
      yield* Workspace,
      yield* Router,
      yield* Addresses,
      yield* SurfaceRegistry,
      yield* Notices,
      yield* ProjectRemoval,
      yield* DesktopFolders.optional(),
    );
  }

  open = $state(false);
  creating = $state(false);
  offered = $state.raw<Offered | null>(null);

  constructor(
    private readonly projects: ProjectsRepo,
    private readonly workspace: Workspace,
    private readonly router: Router,
    private readonly addresses: Addresses,
    private readonly surfaces: SurfaceRegistry,
    private readonly notices: Notices,
    private readonly removal: ProjectRemoval,
    readonly folders: Bridge | undefined,
  ) {
    super();
  }

  async create(draft: ProjectDraft): Promise<void> {
    this.creating = true;
    try {
      const added = await this.projects.add.run(draft, { throwOnError: true });
      await this.workspace.refreshProjects();
      if (added === undefined) return;
      const { project, returned } = added;
      if (returned) {
        this.notices.undoable(`“${labelOf(project)}” is back with its graph and threads`, () => {
          void this.removal.remove(project).catch((error: unknown) => this.notices.refusal(error));
        });
      }
      await this.router.goto(this.addresses.project(project.name, this.surfaces.home));
    } finally {
      this.creating = false;
    }
  }

  async start(): Promise<void> {
    if (this.folders === undefined) {
      this.open = true;
      return;
    }
    const chosen = await this.folders.choose();
    if (chosen === null) return;
    const name = folderName(chosen);
    try {
      await this.create({ name, rootPath: chosen });
    } catch (error) {
      this.offered = { name, rootPath: chosen, refused: refusedOf(error) };
      this.open = true;
    }
  }
}
