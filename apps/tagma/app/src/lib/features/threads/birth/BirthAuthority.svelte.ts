import { Effect } from 'effect';
import { birthApprovalMode, delegation as delegationKey } from '@tagma/server/threads/contract/wire/settings';
import type { ThreadModes } from '@runlith/chat-ui/wire/ChatConnection';
import type { AgentTypes } from '../AgentTypes.svelte.js';
import type { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';
import type { ThreadDraft } from '../Draft.svelte.js';
import { approvalModes } from '../modeWords.js';
import { type AuthorityView, type DelegationPick, DELEGATION_OWN, type DelegationReading } from '../thread/authority.js';
import { refusedBy, ThreadRefused } from '../thread/ThreadRefused.js';

type Settings = ReturnType<typeof SettingsRepo.use>;

export class BirthAuthority implements AuthorityView {
  readonly busy = false;
  readonly terminalRefusal = null;
  readonly notes: readonly string[] = ['The thread this draft starts is born with it.'];

  constructor(
    private readonly draft: ThreadDraft,
    private readonly settings: Settings,
    private readonly types: AgentTypes,
    private readonly projectId: number,
  ) {}

  private entry(id: string): unknown {
    return this.settings.catalog.key(this.projectId).data?.entries.find((row) => row.id === id)?.value;
  }

  private birthMode = $derived.by<string | null>(() => {
    const value = this.entry(birthApprovalMode.id);
    return typeof value === 'string' ? value : null;
  });

  modes = $derived.by<ThreadModes | null>(() => {
    const active = this.draft.approvalMode ?? this.birthMode;
    const declared = this.types.modes;
    return active === null || declared === null ? null : approvalModes(declared, active);
  });

  delegation = $derived.by<DelegationReading>(() => {
    const own = this.draft.delegation;
    const machine = this.entry(delegationKey.id);
    return {
      own,
      allowed: own ?? (typeof machine === 'boolean' ? machine : null),
      origin: own === null ? 'the machine switch' : 'this draft',
      depth: null,
    };
  });

  chooseMode(id: string): Effect.Effect<void, ThreadRefused> {
    return Effect.suspend(() => {
      const modes = this.modes;
      if (modes === null || !modes.declared.some((mode) => mode.id === id)) {
        return Effect.fail(new ThreadRefused({ message: `This thread declares no mode "${id}".` }));
      }
      return id === modes.active ? Effect.void : Effect.sync(() => this.draft.setApprovalMode(id));
    });
  }

  setDelegation(pick: DelegationPick): Effect.Effect<void, ThreadRefused> {
    return Effect.sync(() => this.draft.setDelegation(DELEGATION_OWN[pick]));
  }

  promoteDelegation(): Effect.Effect<void, ThreadRefused> {
    return Effect.suspend(() => {
      const own = this.draft.delegation;
      if (own === null) return Effect.void;
      return Effect.tryPromise({
        try: () =>
          this.settings.write.run({ projectId: this.projectId, scope: 'user', key: delegationKey.id, value: own }, { throwOnError: true }),
        catch: refusedBy,
      }).pipe(Effect.andThen(Effect.sync(() => this.draft.setDelegation(null))));
    });
  }
}
