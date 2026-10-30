import type { Group, Project } from '@tagma/server/graph/contract/wire/rows';
import { Service } from '@runlith/layer/key';
import { ProjectsRepo } from '../workspace/ProjectsRepo.js';
import { Workspace } from '../workspace/Selection.svelte.js';
import { ProjectStrip } from './Strip.svelte.js';

type Projects = ReturnType<typeof ProjectsRepo.use>;

export type GroupPair = { readonly first: Project; readonly second: Project };

export class ProjectGrouping extends Service<ProjectGrouping>()('ProjectGrouping', { tier: 'app' }) {
  static *make() {
    return new ProjectGrouping(yield* ProjectsRepo, yield* Workspace, yield* ProjectStrip);
  }

  asked = $state.raw<GroupPair | null>(null);
  pending = $state(false);

  constructor(
    private readonly projects: Projects,
    private readonly workspace: Workspace,
    private readonly strip: ProjectStrip,
  ) {
    super();
  }

  partners(project: Project): readonly Project[] {
    return this.workspace.projects.filter(
      (other) => other.kind === 'folder' && other.id !== project.id && this.workspace.groupOf(other.id) === null,
    );
  }

  ask(first: Project, second: Project): void {
    this.asked = { first, second };
  }

  dismiss(): void {
    if (!this.pending) this.asked = null;
  }

  async form(pair: GroupPair, name: string): Promise<void> {
    await this.acting(async () => {
      await this.projects.makeGroup.run({ name, projects: [pair.first.id, pair.second.id] }, { throwOnError: true });
      this.strip.include([pair.first.id, pair.second.id]);
      if (this.asked === pair) this.asked = null;
    });
  }

  async join(group: Group, project: Project): Promise<void> {
    await this.acting(async () => {
      await this.projects.joinGroup.run({ groupId: group.graph.id, projectId: project.id }, { throwOnError: true });
      this.strip.include([project.id]);
    });
  }

  async leave(project: Project): Promise<void> {
    await this.acting(() => this.projects.leaveGroup.run(project.id, { throwOnError: true }));
  }

  private async acting(work: () => Promise<unknown>): Promise<void> {
    this.pending = true;
    try {
      await work();
      await this.workspace.refreshProjects();
    } finally {
      this.pending = false;
    }
  }
}
