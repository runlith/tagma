import { Effect } from 'effect';
import type { ChatNotice } from '@runlith/chat-ui/notice';
import type { ThreadOpeningCopy } from '@runlith/chat-ui/session/ThreadOpening.svelte';
import { type ChatBirth, ChatBirthFailed, type ChatBorn } from '@runlith/chat-ui/session/TurnCommands.svelte';
import type { Scope } from '@runlith/layer/Scope';
import type { Told } from '$lib/wire/told.js';
import { toldOf } from '$lib/wire/refusal.js';
import type { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';
import type { Notices } from '$lib/features/notices/Service.svelte.js';
import type { UsageAccounts } from '$lib/features/providers/usage/Accounts.svelte.js';
import type { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
import type { Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';
import type { AgentTypes } from '../AgentTypes.svelte.js';
import type { ChatHold } from '../ChatHold.svelte.js';
import type { ThreadDraft } from '../Draft.svelte.js';
import type { Favorites } from '../Favorites.svelte.js';
import { sourcesMessage } from '../instructionsWords.js';
import { draftedType } from '../launch.js';
import type { ThreadList } from '../List.svelte.js';
import type { ModelDefaults } from '../ModelDefaults.svelte.js';
import type { DraftShelf } from '../native/DraftShelf.svelte.js';
import type { ThreadsRepo } from '../Repo.js';
import type { SlotContext, SlotSelection, SlotWriter } from '../SlotSelection.svelte.js';
import type { TeamRepo } from '../team/TeamRepo.js';
import { closedCall, refusedBy, type ThreadRefused } from '../thread/ThreadRefused.js';
import { BirthAuthority } from './BirthAuthority.svelte.js';
import { BirthPlace, placeOfBirth } from './BirthPlace.svelte.js';
import { BirthSettings } from './BirthSettings.svelte.js';
import { BirthTeam } from './BirthTeam.svelte.js';

type Threads = ReturnType<typeof ThreadsRepo.use>;
type Settings = ReturnType<typeof SettingsRepo.use>;
type Teams = ReturnType<typeof TeamRepo.use>;
type CreatePayload = Parameters<Threads['create']['run']>[0]['payload'];

const STARTERS = ['What changed in this project today?', 'Which tasks are ready to start?', 'How is this codebase organised?'];

export class ThreadBirth implements ChatBirth {
  readonly settings: BirthSettings;
  readonly authority: BirthAuthority;
  readonly team: BirthTeam;
  readonly place: BirthPlace;
  launching = $state(false);
  refusal = $state.raw<Told | null>(null);
  private born_: string | null = null;
  private carried: { readonly threadId: string; readonly unbornKey: string } | null = null;
  private heading: { readonly threadId: string; readonly generation: number } | null = null;

  constructor(
    private readonly chat: ChatHold,
    private readonly selection: SlotSelection,
    private readonly writer: SlotWriter,
    private readonly context: SlotContext,
    private readonly scope: Scope,
    private readonly draft: ThreadDraft,
    private readonly shelf: DraftShelf,
    private readonly threads: Threads,
    private readonly projectId: number,
    private readonly list: ThreadList,
    places: Worktrees,
    readonly types: AgentTypes,
    private readonly sources: Settings,
    private readonly defaults: ModelDefaults,
    accounts: UsageAccounts,
    favorites: Favorites,
    catalog: ProviderCatalog,
    teams: Teams,
    notices: Notices,
    private readonly restart: () => void,
  ) {
    this.settings = new BirthSettings(draft, defaults, types, accounts, favorites, catalog);
    this.authority = new BirthAuthority(draft, sources, types, projectId);
    this.place = new BirthPlace(draft, places, selection);
    this.team = new BirthTeam(draft, teams, sources, notices, projectId, (key) =>
      this.carried?.unbornKey === key ? this.carried.threadId : null,
    );
  }

  draftType = $derived.by<string | null>(() => draftedType(this.draft.type, this.types.rows));
  nextType = $derived.by(() => this.draftType ?? this.types.defaultType);

  openingCopy = $derived.by<ThreadOpeningCopy>(() => {
    if (!this.defaults.known) return { starters: [] };
    const type = this.types.rows?.find((row) => row.id === this.nextType);
    return {
      title: type?.name.trim() || 'Tagma',
      detail: type?.description.trim() || 'Works this graph with you',
      starters: STARTERS,
    };
  });

  get busy(): boolean {
    return this.launching || this.settings.busy;
  }

  applyType(id: string | null): void {
    if (this.selection.activeId === null) this.draft.setType(id);
  }

  refreshSources(): Effect.Effect<ChatNotice | void, ThreadRefused> {
    return Effect.tryPromise({
      try: () => this.sources.reloadSources.run(this.projectId, { throwOnError: true }),
      catch: refusedBy,
    }).pipe(
      Effect.map((found) =>
        found === undefined
          ? undefined
          : ({ tone: found.rejected.length > 0 ? 'error' : 'success', message: sourcesMessage(found) } as const),
      ),
    );
  }

  dismiss(): void {
    this.refusal = null;
  }

  async launch(type: string): Promise<string | null> {
    if (this.busy || this.chat.commands.pending) return null;
    this.dismiss();
    this.launching = true;
    const generation = this.selection.generation;
    try {
      const place = this.place.chosen;
      const payload = await this.place.bear(
        place,
        () => this.create({ type, task: '', ...placeOfBirth(place) }),
        () => void this.launch(type),
      );
      if (payload === null) return null;
      const id = payload.snapshot.thread.id;
      if (!this.scope.signal.aborted && this.selection.generation === generation) this.writer.open(id);
      return id;
    } catch (error) {
      if (!this.scope.signal.aborted) this.refusal = toldOf(error);
      return null;
    } finally {
      this.launching = false;
    }
  }

  born(): Effect.Effect<ChatBorn | null, ChatBirthFailed> {
    return Effect.map(
      Effect.tryPromise({ try: () => this.bear(), catch: (error) => new ChatBirthFailed({ message: refusedBy(error).message }) }),
      (threadId) => (threadId === null ? null : { threadId, draftKey: this.selection.draftKey(threadId) }),
    );
  }

  discard(threadId: string): Effect.Effect<void, ChatBirthFailed> {
    return Effect.tryPromise({
      try: async () => {
        await this.threads.remove.run({ id: threadId, projectId: this.projectId }, { throwOnError: true });
        const carried = this.carried;
        this.carried = null;
        const heading = this.heading?.threadId === threadId ? this.heading : null;
        this.heading = null;
        const owned = this.selection.activeId === threadId || (heading !== null && this.selection.generation === heading.generation);
        if (carried?.threadId === threadId && owned) this.shelf.rename(this.selection.draftKey(threadId), carried.unbornKey);
        if (owned) this.writer.navigate(null);
      },
      catch: (error) => new ChatBirthFailed({ message: refusedBy(error).message }),
    });
  }

  settled(): Effect.Effect<void> {
    return Effect.sync(() => {
      if (this.born_ !== null) this.list.births.settle(this.born_, this.chat.session?.activeRunId ?? null);
      this.born_ = null;
    });
  }

  private async create(payload: CreatePayload) {
    const made = await this.threads.create.run({ projectId: this.projectId, payload }, { throwOnError: true });
    if (made === undefined) throw closedCall();
    return made;
  }

  private async bear(): Promise<string | null> {
    if (this.selection.activeId !== null) return null;
    const generation = this.selection.generation;
    const unbornKey = this.selection.draftKey(null);
    const scopeName = this.context.scopeName();
    const approval = this.draft.approvalMode ?? undefined;
    const place = this.place.chosen;
    const name = this.draft.name;
    const create = () =>
      this.create({
        scopeName: scopeName ?? undefined,
        type: this.draftType ?? undefined,
        account: this.draft.account ?? undefined,
        approvalMode: approval,
        delegation: this.draft.delegation ?? undefined,
        team: this.draft.team ?? undefined,
        ...placeOfBirth(place),
        switches: this.draft.switches,
        name,
        nameOrigin: 'generated',
      });
    const chosen = this.settings.settings;
    const aim = {
      name,
      agentId: this.nextType,
      provider: chosen?.provider ?? '',
      model: chosen?.model || null,
      reasoning: chosen?.reasoning || null,
      root: place.kind === 'worktree' ? place.rootId : null,
    };
    const id = await this.list.births.bear(aim, async () => {
      const payload = await this.place.bear(place, create, this.restart, name);
      return payload === null ? null : payload.snapshot.thread.id;
    });
    if (id === null) return null;
    this.born_ = id;
    if (this.selection.generation === generation) {
      this.shelf.rename(unbornKey, this.selection.draftKey(id));
      this.carried = { threadId: id, unbornKey };
      if (!this.scope.signal.aborted) {
        this.heading = { threadId: id, generation: this.selection.generation };
        this.writer.navigate(id);
      }
    }
    return id;
  }
}
