import type { AwakeMode, AwakeState } from '@tagma/server/power/contract/wire/power';
import { Failure } from '@runlith/layer/Failure';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { Live, type LiveConnection } from '$lib/wire/Live.js';

type Settings = ReturnType<typeof SettingsRepo.use>;

const KEEP_AWAKE = 'power.keepAwake';

export class Awake extends Service<Awake>()('Awake', { tier: 'app' }) {
  static *make() {
    return new Awake(yield* Live, yield* SettingsRepo, yield* Workspace, yield* Scope, yield* Failure);
  }

  standing = $state.raw<AwakeState | null>(null);
  choosing = $state<AwakeMode | null>(null);
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
      (client) => client['awake.subscribe']({}),
      (frame) => {
        this.standing = frame;
      },
      (reason) => {
        if (reason.kind === 'subscription') failure.report(new Error(reason.message));
      },
    );
    scope.defer(() => held.unsubscribe());
  }

  async choose(mode: AwakeMode): Promise<void> {
    if (this.choosing !== null) return;
    this.choosing = mode;
    this.problem = null;
    try {
      const projectId = this.workspace.contextProject?.id;
      if (projectId === undefined) throw new Error('No registered project can resolve the settings catalog.');
      await this.settings.write.run({ projectId, scope: 'user', key: KEEP_AWAKE, value: mode }, { throwOnError: true });
    } catch (caught) {
      this.problem = caught instanceof Error ? caught.message : String(caught);
    } finally {
      this.choosing = null;
    }
  }
}
