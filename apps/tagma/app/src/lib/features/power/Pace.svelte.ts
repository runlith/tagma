import type { PaceLevel, PaceState } from '@tagma/server/power/contract/wire/power';
import { Failure } from '@runlith/layer/Failure';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { Live, type LiveConnection } from '$lib/wire/Live.js';

const AGENT_WORK = 'power.agentWork';

export const PACE_LABEL: Record<PaceLevel, string> = { full: 'Full', low: 'Low', lowest: 'Lowest' };

type PaceTrouble = { readonly key: string; readonly title: string; readonly note: string | undefined };

export class Pace extends Service<Pace>()('Pace', { tier: 'app' }) {
  static *make() {
    return new Pace(yield* Live, yield* SettingsRepo, yield* Workspace, yield* Scope, yield* Failure);
  }

  standing = $state.raw<PaceState | null>(null);
  choosing = $state<PaceLevel | null>(null);
  problem = $state<string | null>(null);
  private dismissed = $state<string | null>(null);

  constructor(
    live: LiveConnection,
    private readonly settings: SettingsRepo,
    private readonly workspace: Workspace,
    scope: Scope,
    failure: Failure,
  ) {
    super();
    const held = live.hold(
      (client) => client['pace.subscribe']({}),
      (frame) => {
        this.standing = frame;
        if (this.dismissed !== null && this.trouble?.key !== this.dismissed) this.dismissed = null;
      },
      (reason) => {
        if (reason.kind === 'subscription') failure.report(new Error(reason.message));
      },
    );
    scope.defer(() => held.unsubscribe());
  }

  async choose(pace: PaceLevel): Promise<void> {
    if (this.choosing !== null || this.standing?.pace === pace) return;
    this.choosing = pace;
    this.problem = null;
    try {
      const projectId = this.workspace.contextProject?.id;
      if (projectId === undefined) throw new Error('No registered project can resolve the settings catalog.');
      await this.settings.write.run({ projectId, scope: 'user', key: AGENT_WORK, value: pace }, { throwOnError: true });
    } catch (caught) {
      this.problem = caught instanceof Error ? caught.message : String(caught);
    } finally {
      this.choosing = null;
    }
  }

  private get trouble(): PaceTrouble | null {
    if (this.problem !== null) return { key: 'unsaved', title: "Agents' share was not saved", note: this.problem };
    const standing = this.standing;
    if (standing === null) return null;
    const level = PACE_LABEL[standing.pace];
    const state = standing.state;
    if (state._tag === 'unavailable')
      return {
        key: `${standing.pace}:unavailable:${state.reason}`,
        title: `${level} is not applied to agents' commands`,
        note: state.reason,
      };
    if (state._tag === 'applied' && state.failed > 0) {
      const whom = state.failed === 1 ? '1 running process' : `${state.failed} running processes`;
      return { key: `${standing.pace}:failed:${state.failed}`, title: `${whom} could not be moved to ${level}`, note: undefined };
    }
    return null;
  }

  get shown(): PaceTrouble | null {
    const trouble = this.trouble;
    return trouble === null || trouble.key === this.dismissed ? null : trouble;
  }

  dismiss(): void {
    if (this.problem !== null) this.problem = null;
    else this.dismissed = this.trouble?.key ?? null;
  }
}
