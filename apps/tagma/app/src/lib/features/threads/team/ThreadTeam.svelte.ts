import type { ReviewPolicy, TeamEdit, TeamLayer } from '@runlith/agent/collaboration/team';
import { Service } from '@runlith/layer/key';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';
import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
import { ThreadRung } from '$lib/features/workspace/ThreadRung.js';
import { withEdit } from './edits.js';
import { type TeamPromoted, type TeamRead, TeamRepo } from './TeamRepo.js';
import type { TeamView } from './view.js';

type Unsent = { readonly layer: TeamLayer | null };

export const PROMOTED_WORDS = 'Every thread of the project now uses this.';

export async function restoreProject(settings: SettingsRepo, projectId: number, previous: TeamPromoted['previous']): Promise<void> {
  const project = { projectId, scope: 'project' as const };
  await settings.write.run({ ...project, key: 'agent.models', value: previous.models ?? undefined }, { throwOnError: true });
  await settings.write.run({ ...project, key: 'agent.review', value: previous.review ?? undefined }, { throwOnError: true });
}

export class ThreadTeam extends Service<ThreadTeam>()('ThreadTeam', { tier: 'thread' }) implements TeamView {
  static *make() {
    return new ThreadTeam(
      (yield* ThreadRung.Current).id,
      (yield* ProjectRung.Current).projectId,
      yield* TeamRepo,
      yield* SettingsRepo,
      yield* Notices,
    );
  }

  private pending = $state.raw<TeamLayer | null>(null);
  private unsent: Unsent | null = null;
  private flushing: Promise<void> | null = null;

  constructor(
    readonly threadId: string,
    readonly projectId: number,
    private readonly teams: TeamRepo,
    private readonly settings: SettingsRepo,
    private readonly notices: Notices,
  ) {
    super();
  }

  private get query() {
    return this.teams.read.key({ projectId: this.projectId, threadId: this.threadId });
  }

  get read(): TeamRead | undefined {
    return this.query.data;
  }

  get layer(): TeamLayer | null {
    if (this.pending !== null) return this.pending;
    const read = this.read;
    return read === undefined ? null : { models: read.edits, review: read.team.review };
  }

  get differs(): boolean {
    return this.read?.differs ?? false;
  }

  get busy(): boolean {
    return this.teams.promote.pending;
  }

  refresh(): void {
    if (this.flushing === null) void this.query.refresh();
  }

  edit(edit: TeamEdit): Promise<void> {
    const layer = this.layer;
    return layer === null ? Promise.resolve() : this.write({ models: withEdit(layer.models, edit), review: layer.review });
  }

  review(review: ReviewPolicy): Promise<void> {
    const layer = this.layer;
    return layer === null ? Promise.resolve() : this.write({ models: layer.models, review });
  }

  reset(): Promise<void> {
    this.pending = null;
    this.unsent = { layer: null };
    return this.flush();
  }

  async promote(): Promise<void> {
    await this.flushing;
    const promoted = await this.teams.promote
      .run({ projectId: this.projectId, threadId: this.threadId }, { throwOnError: true })
      .catch((error: unknown) => {
        this.notices.refusal(error);
        return undefined;
      });
    await this.query.refresh();
    if (promoted === undefined || promoted.promoted === null) return;
    this.notices.undoable(PROMOTED_WORDS, () => void this.undo(promoted));
  }

  private async undo({ promoted, previous }: TeamPromoted): Promise<void> {
    try {
      await restoreProject(this.settings, this.projectId, previous);
      await this.teams.set.run({ projectId: this.projectId, threadId: this.threadId, team: promoted }, { throwOnError: true });
    } catch (error) {
      this.notices.refusal(error);
    }
    await this.query.refresh();
  }

  private write(layer: TeamLayer): Promise<void> {
    this.pending = layer;
    this.unsent = { layer };
    return this.flush();
  }

  private flush(): Promise<void> {
    this.flushing ??= this.drain().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async drain(): Promise<void> {
    while (this.unsent !== null) {
      try {
        while (this.unsent !== null) {
          const { layer } = this.unsent;
          this.unsent = null;
          await this.teams.set.run({ projectId: this.projectId, threadId: this.threadId, team: layer }, { throwOnError: true });
        }
      } catch (error) {
        this.unsent = null;
        this.notices.refusal(error);
      }
      await this.query.refresh();
    }
    this.pending = null;
  }
}
