import type { ApprovalModeView } from '@runlith/agent/modes/ApprovalMode';
import type { ThreadTypeRow } from '@tagma/server/threads/contract/wire/birth';
import { DEFAULT_THREAD_TYPE } from '@tagma/server/threads/contract/wire/settings';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
import { ThreadsRepo } from './Repo.js';
import { agentsOf, launchRows, type LaunchRow } from './launch.js';

export type RejectedAgentFile = { readonly path: string; readonly reason: string };

export class AgentTypes extends Service<AgentTypes>()('AgentTypes', { tier: 'project' }) {
  static *make() {
    return new AgentTypes(yield* ThreadsRepo, (yield* ProjectRung.Current).projectId, yield* Notices, yield* Scope);
  }

  rows = $state<readonly ThreadTypeRow[] | null>(null);
  rejected = $state<readonly RejectedAgentFile[]>([]);
  modes = $state<readonly ApprovalModeView[] | null>(null);
  defaultType = $state<string>(DEFAULT_THREAD_TYPE);
  agents = $derived<readonly ThreadTypeRow[]>(agentsOf(this.rows ?? []));
  launches = $derived<readonly LaunchRow[]>(launchRows(this.rows ?? []));
  served = $derived<ReadonlySet<string>>(new Set((this.rows ?? []).flatMap((row) => row.harness?.serves ?? [])));

  searching = $state(false);

  private reading: Promise<void> | null = null;
  private asked = 0;

  constructor(
    private readonly threads: ThreadsRepo,
    private readonly projectId: number,
    private readonly notices: Notices,
    private readonly scope: Scope,
  ) {
    super();
  }

  read(refresh = false, rescan = false): Promise<void> {
    if (!refresh && this.reading !== null) return this.reading;
    const asked = ++this.asked;
    this.searching = rescan;
    const reading = this.threads.types
      .run({ projectId: this.projectId, rescan }, { throwOnError: true })
      .then((page) => {
        if (this.scope.signal.aborted || asked !== this.asked || page === undefined) return;
        ({ types: this.rows, rejected: this.rejected, default: this.defaultType, modes: this.modes } = page);
      })
      .catch((error: unknown) => {
        if (this.scope.signal.aborted || asked !== this.asked) return;
        if (rescan) this.notices.refusal(error);
        else this.notices.background(error);
      })
      .finally(() => {
        if (this.reading === reading) this.reading = null;
        if (asked === this.asked) this.searching = false;
      });
    this.reading = reading;
    return reading;
  }
}
