import { Service } from '@runlith/layer/key';
import { ProjectRung, type ProjectAim } from './ProjectRung.js';

export class ProjectFocus extends Service<ProjectFocus>()('ProjectFocus', { tier: 'project' }) {
  static *make() {
    return new ProjectFocus(yield* ProjectRung.Source, yield* ProjectRung.Current);
  }

  readonly current: boolean;

  constructor(
    private readonly source: () => ProjectAim | undefined,
    private readonly aim: ProjectAim,
  ) {
    super();
    this.current = $derived(this.source()?.projectId === this.aim.projectId);
  }
}
