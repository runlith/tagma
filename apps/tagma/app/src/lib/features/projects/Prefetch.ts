import type { Project } from '@tagma/server/graph/contract/wire/rows';
import { RungClosedError } from '@runlith/layer/App';
import { Failure } from '@runlith/layer/Failure';
import { Prepare } from '@runlith/layer/Prepare';
import { type InstanceOf, Service } from '@runlith/layer/key';
import { GraphRung } from '../workspace/GraphRung.js';
import { ProjectRung } from '../workspace/ProjectRung.js';
import { Visits } from '../workspace/Visits.svelte.js';

const HOVER_MS = 150;

export type PrepareRung = InstanceOf<typeof Prepare>;

export class ProjectPrefetch extends Service<ProjectPrefetch>()('ProjectPrefetch', { tier: 'app' }) {
  static *make() {
    return new ProjectPrefetch(yield* Prepare, yield* Visits, yield* Failure);
  }

  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly prepare: PrepareRung,
    private readonly visits: Visits,
    private readonly failure: Failure,
  ) {
    super();
  }

  of(project: Project): Promise<void> {
    const projectId = project.id;
    const own = this.prepare(ProjectRung, { projectId });
    const graph = this.prepare(GraphRung, { projectId, branch: this.visits.branchOf(project) }).catch((error: unknown) => {
      if (error instanceof RungClosedError) return;
      throw error;
    });
    return Promise.all([own, graph]).then(() => undefined);
  }

  ahead(project: Project): void {
    this.of(project).catch((error: unknown) => this.failure.report(error));
  }

  hover(project: Project): void {
    this.leave();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.ahead(project);
    }, HOVER_MS);
  }

  leave(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
