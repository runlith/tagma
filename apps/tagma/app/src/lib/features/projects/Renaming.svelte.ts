import { Service } from '@runlith/layer/key';
import type { Project } from '@tagma/server/graph/contract/wire/rows';
import { ProjectsRepo } from '../workspace/ProjectsRepo.js';
import { Workspace } from '../workspace/Selection.svelte.js';

export class ProjectRenaming extends Service<ProjectRenaming>()('ProjectRenaming', { tier: 'app' }) {
  static *make() {
    return new ProjectRenaming(yield* ProjectsRepo, yield* Workspace);
  }

  asked = $state.raw<Project | null>(null);
  renaming = $state(false);

  constructor(
    private readonly projects: ProjectsRepo,
    private readonly workspace: Workspace,
  ) {
    super();
  }

  ask(project: Project): void {
    if (project.kind !== 'global') this.asked = project;
  }

  dismiss(): void {
    if (!this.renaming) this.asked = null;
  }

  async rename(project: Project, name: string): Promise<void> {
    this.renaming = true;
    try {
      if (project.kind === 'group') await this.projects.renameGroup.run({ groupId: project.id, name }, { throwOnError: true });
      else await this.projects.rename.run({ projectId: project.id, name }, { throwOnError: true });
      await this.workspace.refreshProjects();
      if (this.asked?.id === project.id) this.asked = null;
    } finally {
      this.renaming = false;
    }
  }
}
