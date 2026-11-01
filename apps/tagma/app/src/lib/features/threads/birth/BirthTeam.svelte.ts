import type { ReviewPolicy, TeamEdit, TeamLayer } from '@runlith/agent/collaboration/team';
import type { Notices } from '$lib/features/notices/Service.svelte.js';
import type { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';
import type { DraftChoices, ThreadDraft } from '../Draft.svelte.js';
import { withEdit } from '../team/edits.js';
import { PROMOTED_WORDS, restoreProject } from '../team/ThreadTeam.svelte.js';
import type { TeamPromoted, TeamRead, TeamRepo } from '../team/TeamRepo.js';
import type { TeamView } from '../team/view.js';

export class BirthTeam implements TeamView {
  private held = $state.raw<{ readonly key: string; readonly read: TeamRead } | null>(null);

  constructor(
    private readonly draft: ThreadDraft,
    private readonly teams: TeamRepo,
    private readonly settings: SettingsRepo,
    private readonly notices: Notices,
    private readonly projectId: number,
    private readonly bornOf: (draftKey: string) => string | null,
  ) {}

  private get project() {
    return this.teams.read.key({ projectId: this.projectId, threadId: null, layer: 'project' });
  }

  private copied(team: TeamLayer) {
    return this.teams.read.key({ projectId: this.projectId, threadId: null, team });
  }

  get read(): TeamRead | undefined {
    const own = this.draft.team;
    if (own === null) return this.project.data;
    const held = this.held?.key === this.draft.key ? this.held.read : undefined;
    return this.copied(own).data ?? held ?? this.project.data;
  }

  get layer(): TeamLayer | null {
    const own = this.draft.team;
    if (own !== null) return own;
    const project = this.project.data;
    return project === undefined ? null : { models: project.edits, review: project.team.review };
  }

  get differs(): boolean {
    return this.draft.team !== null && (this.read?.differs ?? true);
  }

  get busy(): boolean {
    return this.teams.promote.pending;
  }

  refresh(): void {
    void this.project.refresh();
  }

  edit(edit: TeamEdit): Promise<void> {
    const layer = this.layer;
    return layer === null ? Promise.resolve() : this.choose({ models: withEdit(layer.models, edit), review: layer.review });
  }

  review(review: ReviewPolicy): Promise<void> {
    const layer = this.layer;
    return layer === null ? Promise.resolve() : this.choose({ models: layer.models, review });
  }

  reset(): Promise<void> {
    this.draft.setTeam(null);
    return Promise.resolve();
  }

  async promote(): Promise<void> {
    const own = this.draft.team;
    if (own === null) return;
    const key = this.draft.key;
    const pinned = this.draft.pin();
    const promoted = await this.teams.promote
      .run({ projectId: this.projectId, team: own }, { throwOnError: true })
      .catch((error: unknown) => {
        this.notices.refusal(error);
        return undefined;
      });
    if (promoted === undefined) return;
    pinned.setTeam(null);
    await this.project.refresh();
    this.notices.undoable(PROMOTED_WORDS, () => void this.undo(promoted, key, pinned));
  }

  private async choose(team: TeamLayer): Promise<void> {
    const key = this.draft.key;
    this.draft.setTeam(team);
    const read = await this.copied(team).load();
    if (read !== undefined) this.held = { key, read };
  }

  private async undo({ promoted, previous }: TeamPromoted, key: string, pinned: DraftChoices): Promise<void> {
    try {
      await restoreProject(this.settings, this.projectId, previous);
      const born = this.bornOf(key);
      if (born === null) pinned.setTeam(promoted);
      else await this.teams.set.run({ projectId: this.projectId, threadId: born, team: promoted }, { throwOnError: true });
    } catch (error) {
      this.notices.refusal(error);
    }
    await this.project.refresh();
  }
}
