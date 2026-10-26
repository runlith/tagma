import type { PaceLevel, PaceState } from '@tagma/server/power/contract/wire/power';
import { Failure } from '@runlith/layer/Failure';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { Live, type LiveConnection } from '$lib/wire/Live.js';

type Settings = ReturnType<typeof SettingsRepo.use>;

const AGENT_WORK = 'power.agentWork';

export const PACE_LABEL: Record<PaceLevel, string> = { full: 'Full', low: 'Low', lowest: 'Lowest' };

export class Pace extends Service<Pace>()('Pace', { tier: 'app' }) {
  static *make() {
    return new Pace(yield* Live, yield* SettingsRepo, yield* Workspace, yield* Scope, yield* Failure);
  }

  standing = $state.raw<PaceState | null>(null);
  choosing = $state<PaceLevel | null>(null);
  problem = $state<string | null>(null);

  constructor(
    live: LiveConnection,
    private readonly settings: Settings,
    private readonly workspace: Workspace,
    scope: Scope,
    failure: Failure,
  ) {
    super();
    const held = live.hold(
      (client) => client['pace.subscribe']({}),
      (frame) => {
        this.standing = frame;
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

  dismiss(): void {
    this.problem = null;
  }
}
