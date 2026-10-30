import { Service } from '@runlith/layer/key';
import { Router } from '@runlith/layer/Router';
import type { Project } from '@tagma/server/graph/contract/wire/rows';
import { ProjectsRepo } from '../workspace/ProjectsRepo.js';
import { Workspace } from '../workspace/Selection.svelte.js';
import { ProjectStrip } from './Strip.svelte.js';

type Projects = ReturnType<typeof ProjectsRepo.use>;

export class ProjectRemoval extends Service<ProjectRemoval>()('ProjectRemoval', { tier: 'app' }) {
  static *make() {
    return new ProjectRemoval(yield* ProjectsRepo, yield* Workspace, yield* ProjectStrip, yield* Router);
  }

  asked = $state.raw<Project | null>(null);
  removing = $state(false);

  constructor(
    private readonly projects: Projects,
    private readonly workspace: Workspace,
    private readonly strip: ProjectStrip,
    private readonly router: Router,
  ) {
    super();
  }

  ask(project: Project): void {
    if (project.kind === 'folder') this.asked = project;
  }

  dismiss(): void {
    if (!this.removing) this.asked = null;
  }

  async remove(project: Project): Promise<void> {
    this.removing = true;
    try {
      const open = this.workspace.activeId === project.id;
      await this.projects.remove.run(project.id, { throwOnError: true });
      this.strip.remove(project.id);
      await this.workspace.refreshProjects();
      if (this.asked?.id === project.id) this.asked = null;
      if (open) await this.router.goto('/');
    } finally {
      this.removing = false;
    }
  }
}
